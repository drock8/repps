import { useState } from "react";

interface YouTubeEmbedProps {
  videoId: string;
}

export default function YouTubeEmbed({ videoId }: YouTubeEmbedProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div
        className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center"
        onClick={() => setExpanded(false)}
      >
        <div
          className="w-full max-w-md mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative w-full rounded-xl overflow-hidden aspect-video">
            <iframe
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
              title="REPPs intro"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="mt-3 w-full text-center text-caption text-white/60"
          >
            Tap to close
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      className="w-full rounded-lg overflow-hidden bg-bg-elevated relative group"
    >
      <img
        src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
        alt="Watch intro video"
        className="w-full h-auto block"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[4.5rem] h-[4.5rem] rounded-full bg-black/60 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8 ml-0.5">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </button>
  );
}
