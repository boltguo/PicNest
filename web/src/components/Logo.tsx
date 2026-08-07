/**
 * The app mark: a photo resting in a nest. Served from `public/logo.svg`,
 * which is also the browser favicon — one file, one identity.
 */
export function Logo({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="" width={32} height={32} className={className} />;
}
