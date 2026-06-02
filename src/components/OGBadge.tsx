export default function OGBadge({ size = 18 }: { size?: number }) {
  return (
    <img
      src="/og-badge.png"
      alt="OG 100"
      width={size}
      height={size}
      className="inline-block flex-shrink-0"
    />
  );
}
