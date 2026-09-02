import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret",
      OTP_PEPPER: "test-otp-pepper",
    },
  },
});
