export default function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-avatar-bg text-avatar-text flex items-center justify-center text-caption font-bold flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
