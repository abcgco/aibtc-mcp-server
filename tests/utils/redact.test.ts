import { describe, it, expect } from "vitest";
import { redactSensitive } from "../../src/utils/redact.js";

describe("redactSensitive", () => {
  it("should redact password in double quotes", () => {
    const input = '{"password":"secret123"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"password":"[REDACTED]"}');
  });

  it("should redact mnemonic in double quotes", () => {
    const input = '{"mnemonic":"word1 word2 word3"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"mnemonic":"[REDACTED]"}');
  });

  it("should redact secret in double quotes", () => {
    const input = '{"secret":"topsecret"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"secret":"[REDACTED]"}');
  });

  it("should redact privateKey in double quotes", () => {
    const input = '{"privateKey":"0x123456"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"privateKey":"[REDACTED]"}');
  });

  it("should leave non-sensitive fields unchanged", () => {
    const input = '{"username":"alice","email":"alice@example.com"}';
    const output = redactSensitive(input);
    expect(output).toBe(input);
  });

  it("should redact multiple sensitive fields", () => {
    const input = '{"password":"secret123","mnemonic":"word1 word2"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"password":"[REDACTED]","mnemonic":"[REDACTED]"}');
  });

  it("should handle case insensitive matching - Password", () => {
    const input = '{"Password":"secret123"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"Password":"[REDACTED]"}');
  });

  it("should handle case insensitive matching - PASSWORD", () => {
    const input = '{"PASSWORD":"secret123"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"PASSWORD":"[REDACTED]"}');
  });

  it("should handle case insensitive matching - MNEMONIC", () => {
    const input = '{"MNEMONIC":"word1 word2"}';
    const output = redactSensitive(input);
    expect(output).toBe('{"MNEMONIC":"[REDACTED]"}');
  });

  it("should return empty string for empty input", () => {
    const input = "";
    const output = redactSensitive(input);
    expect(output).toBe("");
  });

  it("should redact in single quotes", () => {
    const input = "{'password':'secret123'}";
    const output = redactSensitive(input);
    expect(output).toBe("{'password':'[REDACTED]'}");
  });

  it("should redact without surrounding quotes on key", () => {
    const input = '{password:"secret123"}';
    const output = redactSensitive(input);
    expect(output).toBe('{password:"[REDACTED]"}');
  });

  it("should handle mixed sensitive and non-sensitive data", () => {
    const input =
      '{"user":"alice","password":"secret","email":"test@example.com","mnemonic":"word1 word2"}';
    const output = redactSensitive(input);
    expect(output).toContain('"user":"alice"');
    expect(output).toContain('"password":"[REDACTED]"');
    expect(output).toContain('"email":"test@example.com"');
    expect(output).toContain('"mnemonic":"[REDACTED]"');
  });
});
