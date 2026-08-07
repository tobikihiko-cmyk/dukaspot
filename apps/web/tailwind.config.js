export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx}",
    "./tests/**/*.html",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      colors: {
        ink: "#07110f",
        till: "#0b7b68",
      },
      boxShadow: {
        ledger: "0 24px 80px rgba(17, 24, 39, 0.08)",
      },
    },
  },
  plugins: [],
};
