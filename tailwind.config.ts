import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff1f5",
          100: "#ffe4ec",
          200: "#fecdd9",
          300: "#fda4bc",
          400: "#fb7196",
          500: "#f43f74",
          600: "#e11d58",
          700: "#be1248",
          800: "#9f1241",
          900: "#88133d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
