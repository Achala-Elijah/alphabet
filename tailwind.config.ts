import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: "#f00032",
        ink: "#191a1e",
        panel: "#24252b",
        muted: "#92939b",
        odds: "#42bd70"
      }
    }
  },
  plugins: []
};

export default config;
