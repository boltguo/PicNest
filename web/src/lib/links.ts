export type LinkFormat = "url" | "markdown" | "html";
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function formatLink(
  url: string,
  name: string,
  format: LinkFormat,
): string {
  if (format === "html")
    return `<img src="${html(url)}" alt="${html(name)}" />`;
  if (format === "markdown")
    return `![${name.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ")}](<${url.replace(/[<>\r\n]/g, encodeURIComponent)}>)`;
  return url;
}
