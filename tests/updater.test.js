"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, updateDirectory } = require("../src/updater");

describe("compareVersions", () =>
{
    it("returns 0 for equal versions", () =>
    {
        assert.equal(compareVersions("0.5.0", "0.5.0"), 0);
        assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
        assert.equal(compareVersions("0.0.1", "0.0.1"), 0);
    });

    it("returns -1 when first version is lower", () =>
    {
        assert.equal(compareVersions("0.5.0", "0.6.0"), -1);
        assert.equal(compareVersions("0.9.9", "1.0.0"), -1);
        assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
        assert.equal(compareVersions("0.5.0", "0.5.1"), -1);
    });

    it("returns 1 when first version is higher", () =>
    {
        assert.equal(compareVersions("0.6.0", "0.5.0"), 1);
        assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
        assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
    });

    it("handles v prefix", () =>
    {
        assert.equal(compareVersions("v0.6.0", "0.5.0"), 1);
        assert.equal(compareVersions("0.5.0", "v0.6.0"), -1);
        assert.equal(compareVersions("v1.0.0", "v1.0.0"), 0);
    });

    it("handles multi-digit segments", () =>
    {
        assert.equal(compareVersions("0.10.0", "0.9.99"), 1);
        assert.equal(compareVersions("1.20.0", "1.2.0"), 1);
        assert.equal(compareVersions("1.2.0", "1.20.0"), -1);
    });

    it("handles different segment lengths", () =>
    {
        assert.equal(compareVersions("1.0", "1.0.0"), 0);
        assert.equal(compareVersions("1.0.1", "1.0"), 1);
        assert.equal(compareVersions("1.0", "1.0.1"), -1);
    });
});

describe("updateDirectory", () =>
{
    it("returns a path ending with AgentPet/update", () =>
    {
        const dir = updateDirectory();
        assert.ok(dir.endsWith("AgentPet" + String.fromCharCode(92) + "update")
            || dir.endsWith("AgentPet/update"));
    });
});
