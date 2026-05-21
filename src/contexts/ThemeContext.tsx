import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type Theme = "orange" | "blue";

const ThemeContext = createContext<Theme>("orange");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("orange");

  useEffect(() => {
    supabase
      .from("settings")
      .select("value")
      .eq("key", "theme")
      .single()
      .then(({ data }) => {
        if (data?.value === "blue") setTheme("blue");
      });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);

    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const appleTouchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    const iconPath = theme === "blue" ? "/repps-blue-icon-192.png" : "/repps-icon-192.png";
    if (favicon) favicon.href = iconPath;
    if (appleTouchIcon) appleTouchIcon.href = iconPath;
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
