/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#111315",
          surface: "#1C1F24",
          elevated: "#262A30",
          input: "#2A2E33",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          gold: "var(--color-accent-secondary)",
        },
        ink: {
          primary: "#F5F2EA",
          secondary: "#8D9199",
          muted: "#5C6066",
          inverse: "#111315",
        },
        success: "#34C759",
        error: "#FF453A",
        divider: "#2A2E33",
      },
      fontSize: {
        "display-xl": ["64px", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "700" }],
        "display-lg": ["44px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-md": ["32px", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
        headline: ["22px", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-lg": ["17px", { lineHeight: "1.4", fontWeight: "400" }],
        body: ["15px", { lineHeight: "1.4", fontWeight: "400" }],
        caption: ["13px", { lineHeight: "1.35", fontWeight: "500" }],
        micro: ["11px", { lineHeight: "1.3", letterSpacing: "0.04em", fontWeight: "600" }],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        pill: "999px",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      animation: {
        "slide-up": "slideUp 300ms cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
