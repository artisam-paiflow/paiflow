const eslintConfig = [
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["contracts/**", ".next/**", "node_modules/**", "tests/stubs/**", "screenshots/**"],
  },
];

export default eslintConfig;
