import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, PNG, keyFor, eventually } from "./helpers";
import {
  cleanObjects,
  stepJob,
  deleteRows,
} from "../worker/src/lib/maintenance";
import { SerialQueue } from "../worker/src/lib/serial";
import app from "../worker/src/app";

test("incremental migration preserves legacy files and share links", async (t) => {
  const f = await fixture(async (db) => {
    await db
      .prepare(
        "INSERT INTO files (id,key,folder,name,size) VALUES(1,?,'旅行/📷','old.png',20)",
      )
      .bind(keyFor(1))
      .run();
    await db
      .prepare("INSERT INTO shares(token,file_id) VALUES('old-link',1)")
      .run();
  });
  t.after(f.dispose);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM shares").first<any>())!.n,
    1,
  );
  const file = await f.db
    .prepare("SELECT * FROM files WHERE id=1")
    .first<any>();
  assert.equal(file.name, "old.png");
  assert.equal(file.missing, 0);
  assert.equal(file.width, null);
});

test("concurrent upload deduplication, shared references, thumbnails and auth", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  const missingAuth = await f.mf.dispatchFetch("https://picnest.test/api/list");
  assert.equal(missingAuth.status, 401);
  const uploads = await Promise.all([
    f.upload("Photos"),
    f.upload("Photos"),
    f.upload("photos"),
  ]);
  assert.equal(uploads[0].id, uploads[1].id);
  assert.notEqual(uploads[0].id, uploads[2].id);
  await f.json(`/api/file?id=${uploads[0].id}`, { method: "DELETE" });
  assert(await f.env.BUCKET.head(uploads[2].key));
  assert.equal((await f.json("/api/list?folder=photos")).files.length, 1);
  const thumbnail = Buffer.from("RIFF0000WEBPtest");
  const result = await f.request(
    `/api/thumbnail?id=${uploads[2].id}&width=100&height=80`,
    { method: "PUT", body: thumbnail },
  );
  assert.equal(result.status, 200);
  const list = await f.json("/api/list?folder=photos");
  assert.equal(list.files[0].width, 100);
  assert.equal(list.files[0].thumbnail, true);
  assert.equal(
    (await f.request(`/t/${uploads[2].key}`)).headers.get("Content-Type"),
    "image/webp",
  );
  const copy = await f.upload("Another");
  assert.equal(
    (await f.json("/api/list?folder=Another")).files[0].thumbnail,
    true,
  );
  await f.json(`/api/file?id=${copy.id}`, { method: "DELETE" });
  await f.json(`/api/file?id=${uploads[2].id}`, { method: "DELETE" });
  await eventually(async () => !(await f.env.BUCKET.head(uploads[2].key)));
});

test("failed re-upload preserves missing flags and completed deletion markers", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const f = await fixture();
  t.after(f.dispose);
  const first = await f.upload();
  await f.env.BUCKET.delete(first.key);
  await f.db.prepare("UPDATE files SET missing=1").run();
  const { token } = await f.post("/api/login", { password: "test-password" });
  const broken = {
    ...f.env,
    JWT_SECRET: "picnest-test-only-signing-key-not-for-production",
    BUCKET: {
      head: async () => null,
      put: async () => {
        throw new Error("Simulated upload failure");
      },
    } as any,
  };
  const send = () =>
    app.fetch(
      new Request("https://picnest.test/api/upload?name=retry.png", {
        method: "PUT",
        body: PNG,
        headers: { Authorization: `Bearer ${token}` },
      }),
      broken,
    );
  assert.equal((await send()).status, 500);
  assert.equal(
    (await f.db.prepare("SELECT missing FROM files").first<any>())!.missing,
    1,
  );
  await f.upload();
  assert.equal(
    (await f.db.prepare("SELECT missing FROM files").first<any>())!.missing,
    0,
  );
  await f.json(`/api/file?id=${first.id}`, { method: "DELETE" });
  await eventually(
    async () =>
      (await f.db.prepare("SELECT pending FROM object_tombstones").first<any>())
        ?.pending === 0,
  );
  assert.equal((await send()).status, 500);
  assert.equal(
    (await f.db.prepare("SELECT pending FROM object_tombstones").first<any>())!
      .pending,
    0,
  );
  await f.upload();
  assert.equal(
    await f.db.prepare("SELECT * FROM object_tombstones").first(),
    null,
  );
  assert.equal(log.mock.callCount(), 2);
});

test("folder jobs lock writes, survive runtime restart and resume from persisted progress", async (t) => {
  const f = await fixture(undefined, true);
  t.after(f.dispose);
  const file = await f.upload("delete-me");
  const job = await f.json("/api/folder?path=delete-me", { method: "DELETE" });
  assert.equal(
    (
      await f.request("/api/upload?folder=delete-me&name=x.png", {
        method: "PUT",
        body: PNG,
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.request(`/api/file?id=${file.id}`, { method: "DELETE" })).status,
    409,
  );
  // A failed job keeps its subtree locked, and retry is explicit.
  await f.db
    .prepare("UPDATE jobs SET status='error', error='interrupted' WHERE id=?")
    .bind(job.id)
    .run();
  await f.restart();
  assert.equal((await f.json("/api/jobs")).jobs[0].status, "error");
  await f.post(`/api/jobs/${job.id}/retry`, {});
  await eventually(
    async () => (await f.json("/api/jobs")).jobs[0].status === "done",
  );
  assert.equal((await f.json("/api/list?folder=delete-me")).files.length, 0);
  assert.equal((await f.json("/api/jobs")).cleanupPending, 0);
});

test("failed object cleanup remains retryable and does not delete new references", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  const key = keyFor(1);
  await f.env.BUCKET.put(key, PNG);
  await f.db
    .prepare("INSERT INTO files(id,key,name,size) VALUES(1,?,'x.png',10)")
    .bind(key)
    .run();
  await deleteRows(f.env, [{ id: 1, key }]);
  const broken = {
    ...f.env,
    BUCKET: {
      delete: async () => {
        throw new Error("R2 unavailable");
      },
    } as any,
  };
  await assert.rejects(cleanObjects(broken), /R2 unavailable/);
  assert.equal(
    (await f.db.prepare("SELECT pending FROM object_tombstones").first<any>())!
      .pending,
    1,
  );
  // A later serialized upload has restored a reference before cleanup retries.
  await f.db
    .prepare("INSERT INTO files(id,key,name,size) VALUES(2,?,'new.png',10)")
    .bind(key)
    .run();
  await cleanObjects(f.env);
  assert(await f.env.BUCKET.head(key));
  assert.equal(
    await f.db.prepare("SELECT * FROM object_tombstones").first(),
    null,
  );
});

test("writer keeps upload behind an in-flight R2 deletion and recovers after failure", async () => {
  const queue = new SerialQueue();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const deletion = queue.run(async () => {
    order.push("delete-start");
    await gate;
    order.push("delete-end");
  });
  const upload = queue.run(async () => {
    order.push("upload");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["delete-start"]);
  release();
  await Promise.all([deletion, upload]);
  assert.deepEqual(order, ["delete-start", "delete-end", "upload"]);
  await assert.rejects(
    queue.run(async () => {
      throw new Error("temporary");
    }),
  );
  assert.equal(await queue.run(async () => 42), 42);
});

test("1300-file deletion resumes in bounded batches and preserves unrelated folders", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  const inserts = Array.from({ length: 1300 }, (_, i) =>
    f.db
      .prepare(
        "INSERT INTO files(key,folder,name,size) VALUES(?,'旅行/📷',?,1)",
      )
      .bind(keyFor(i), `${i}.png`),
  );
  for (let i = 0; i < inserts.length; i += 50)
    await f.db.batch(inserts.slice(i, i + 50));
  await f.db
    .prepare(
      "INSERT INTO files(key,folder,name,size) VALUES(?,'旅行/📸','keep.png',1)",
    )
    .bind(keyFor(9999))
    .run();
  await f.db.prepare("INSERT INTO folders(path) VALUES('旅行/📷')").run();
  await f.db
    .prepare(
      "INSERT INTO jobs(id,kind,path,total,created_at,updated_at) VALUES('delete','delete-folder','旅行/📷',1300,1,1)",
    )
    .run();
  let steps = 0;
  while (
    (await f.db
      .prepare("SELECT status FROM jobs WHERE id='delete'")
      .first<any>())!.status !== "done"
  ) {
    const before = (await f.db
      .prepare("SELECT count(*) AS n FROM files")
      .first<any>())!.n;
    if (!(await cleanObjects(f.env))) await stepJob(f.env);
    const after = (await f.db
      .prepare("SELECT count(*) AS n FROM files")
      .first<any>())!.n;
    assert(before - after <= 25);
    assert(++steps < 250);
  }
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM files").first<any>())!.n,
    1,
  );
  assert.equal(
    (await f.db
      .prepare("SELECT processed FROM jobs WHERE id='delete'")
      .first<any>())!.processed,
    1300,
  );
  assert.equal(
    (await f.db
      .prepare("SELECT count(*) AS n FROM object_tombstones WHERE pending=1")
      .first<any>())!.n,
    0,
  );
});

test("repair keeps missing rows and shares, excludes intentional deletions, and requires explicit import", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  await f.db
    .prepare("INSERT INTO files(id,key,name,size) VALUES(1,?,'missing.png',10)")
    .bind(keyFor(1))
    .run();
  await f.db
    .prepare("INSERT INTO shares(token,file_id) VALUES('keep-share',1)")
    .run();
  await f.env.BUCKET.put(keyFor(2), PNG, {
    customMetadata: { name: "found.png", folder: "旅行" },
  });
  await f.env.BUCKET.put(keyFor(3), PNG);
  await f.db
    .prepare(
      "INSERT INTO object_tombstones(key,pending,created_at) VALUES(?,0,1)",
    )
    .bind(keyFor(3))
    .run();
  await f.db
    .prepare(
      "INSERT INTO jobs(id,kind,created_at,updated_at) VALUES('scan','repair',1,1)",
    )
    .run();
  for (let i = 0; i < 10; i++) {
    await stepJob(f.env);
    if (
      (await f.db.prepare("SELECT status FROM jobs").first<any>())!.status ===
      "done"
    )
      break;
  }
  assert.equal(
    (await f.db.prepare("SELECT missing FROM files WHERE id=1").first<any>())!
      .missing,
    1,
  );
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM shares").first<any>())!.n,
    1,
  );
  const result = await f.json("/api/repair/scan");
  assert.equal(result.findings.length, 2);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM files").first<any>())!.n,
    1,
  );
  await f.post("/api/repair/import", {
    id: result.findings.find((v: any) => v.kind === "unindexed").id,
  });
  const restored = await f.json(
    "/api/list?folder=" + encodeURIComponent("旅行"),
  );
  assert.equal(restored.files[0].name, "found.png");
});

test("pagination is stable with tied sort values and rejects a cursor from another folder", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  for (let i = 1; i <= 105; i++)
    await f.db
      .prepare("INSERT INTO files(key,name,size,created_at) VALUES(?,?,?,100)")
      .bind(keyFor(i), `${String(i).padStart(3, "0")}.png`, Math.floor(i / 3))
      .run();
  for (const sort of [
    "newest",
    "oldest",
    "largest",
    "smallest",
    "nameAsc",
    "nameDesc",
  ]) {
    const ids: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await f.json(
        `/api/list?sort=${sort}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      ids.push(...page.files.map((v: any) => v.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 105);
    assert.equal(new Set(ids).size, 105);
    const descending = ["newest", "largest", "nameDesc"].includes(sort);
    assert.equal(ids[0], descending ? 105 : 1);
  }
  const page = await f.json("/api/list");
  assert.equal(
    (
      await f.request(
        `/api/list?folder=other&cursor=${encodeURIComponent(page.nextCursor)}`,
      )
    ).status,
    400,
  );
});

test("share password, expiry and revocation remain enforced", async (t) => {
  const f = await fixture();
  t.after(f.dispose);
  const file = await f.upload();
  const share = await f.post("/api/share", {
    id: file.id,
    password: "secret",
    hours: 1,
  });
  assert.equal((await f.request(share.url)).status, 401);
  const wrong = await f.request(share.url, {
    method: "POST",
    body: "password=wrong",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  });
  assert(wrong.headers.get("Location")?.includes("e=1"));
  const good = await f.request(share.url, {
    method: "POST",
    body: "password=secret",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  });
  assert.equal(good.status, 303);
  const cookie = good.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await f.request(share.url, { headers: { Cookie: cookie } })).status,
    200,
  );
  await f.db.prepare("UPDATE shares SET expires_at=1").run();
  assert.equal(
    (await f.request(share.url, { headers: { Cookie: cookie } })).status,
    410,
  );
  const other = await f.post("/api/share", { id: file.id });
  await f.json(`/api/share?token=${other.url.split("/").pop()}`, {
    method: "DELETE",
  });
  assert.equal((await f.request(other.url)).status, 404);
});
