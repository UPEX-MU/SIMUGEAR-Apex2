import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Avr109, APP_LIMIT, PAGE_SIZE, parseHex } from "../avr109.js";

const source = readFileSync(new URL("../firmware.hex", import.meta.url));
const image = parseHex(source.toString());
function record(address, type, data) {
  const bytes = [data.length, address >> 8, address & 255, type, ...data];
  bytes.push((-bytes.reduce((a, b) => a + b, 0)) & 255);
  return ":" + bytes.map(n => n.toString(16).padStart(2, "0")).join("");
}
const eof = record(0, 1, []);
const minimal = `${record(0, 0, [12, 148])}\n${eof}`;

test("published image is the exact supplied firmware", () => {
  assert.equal(createHash("sha256").update(source).digest("hex").toUpperCase(), "DB4FA52BC11DBEC000C119A7C5BEFEDE791DCB9F607A9DB1433AF22591D3FF3D");
  assert.equal(image.maxAddress, 11546);
  assert.equal(image.size, 11648);
  assert.ok(image.size < APP_LIMIT);
  const bytes = Buffer.from(image.bytes);
  assert.ok(bytes.includes(Buffer.from("SIMUGEAR Apex2")));
  assert.ok(bytes.includes(Buffer.from([18, 1, 0, 2, 239, 2, 1, 64, 0x8f, 0x35, 0x8d, 0x28])));
});
test("parse accepts valid HEX and fills unused bytes with FF", () => {
  const parsed = parseHex(minimal);
  assert.deepEqual([...parsed.bytes.slice(0, 3)], [12, 148, 255]);
  assert.equal(parsed.size, PAGE_SIZE);
});
test("parse accepts CRLF and trailing whitespace", () => assert.equal(parseHex(minimal.replace(/\n/g, "\r\n") + "\r\n").maxAddress, 2));
test("reject checksum damage", () => assert.throws(() => parseHex(minimal.replace("0c94", "0c95")), /checksum/));
test("reject non-hex characters", () => assert.throws(() => parseHex(":GG\n" + eof), /Invalid/));
test("reject inconsistent record length", () => assert.throws(() => parseHex(":030000000c945e\n" + eof), /length/));
test("reject missing EOF", () => assert.throws(() => parseHex(record(0, 0, [12, 148])), /Incomplete/));
test("reject empty image", () => assert.throws(() => parseHex(eof), /Incomplete/));
test("reject image without reset vector", () => assert.throws(() => parseHex(record(100, 0, [12, 148]) + "\n" + eof), /Incomplete/));
test("reject conflicting address data", () => assert.throws(() => parseHex(record(0, 0, [12, 148]) + "\n" + record(0, 0, [10]) + "\n" + eof), /Conflicting/));
test("reject data after EOF", () => assert.throws(() => parseHex(minimal + "\n" + record(0, 0, [1])), /Invalid/));
test("reject bootloader area", () => assert.throws(() => parseHex(record(APP_LIMIT, 0, [1]) + "\n" + minimal), /application area/));
test("reject extended address outside application", () => assert.throws(() => parseHex(record(0, 4, [0, 1]) + "\n" + minimal), /application area/));
test("reject unsupported record types", () => assert.throws(() => parseHex(record(0, 3, [0, 0, 0, 0]) + "\n" + minimal), /Unsupported/));

function mockPort({ signature = [135, 149, 30], corruptRead = false, silent = false } = {}) {
  let controller;
  let address = 0;
  const flash = new Uint8Array(APP_LIMIT).fill(255);
  const commands = [];
  let closed = false;
  const reply = data => { if (!silent) controller.enqueue(Uint8Array.from(data)); };
  return {
    commands, flash,
    get closed() { return closed; },
    async open(options) {
      assert.equal(options.baudRate, 57600);
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({ write(data) {
        commands.push([...data]);
        if (data[0] === 83) reply([...Buffer.from("CATERIN")]);
        else if (data[0] === 115) reply(signature);
        else if (data[0] === 98) reply([89, 0, 128]);
        else if (data[0] === 65) { address = (data[1] * 256 + data[2]) * 2; reply([13]); }
        else if (data[0] === 66) { flash.set(data.slice(4), address); reply([13]); }
        else if (data[0] === 103) { const bytes = flash.slice(address, address + 128); if (corruptRead) bytes[0] ^= 1; reply(bytes); }
        else if (data[0] === 69) reply([13]);
        else throw new Error("Unexpected command");
      }});
    },
    async close() { closed = true; }
  };
}

test("AVR109 identifies, writes and verifies entire real image", async () => {
  const port = mockPort();
  const avr = new Avr109(port);
  await avr.open();
  assert.equal(await avr.identify(), "CATERIN");
  for (let address = 0; address < image.size; address += PAGE_SIZE) {
    const page = image.bytes.slice(address, address + PAGE_SIZE);
    await avr.writePage(address, page);
    await avr.verifyPage(address, page);
  }
  await avr.leave();
  await avr.close();
  assert.deepEqual(port.flash.slice(0, image.size), image.bytes);
  assert.ok(port.commands.every(c => ![101, 68, 108].includes(c[0])));
  assert.ok(port.closed);
});
test("wrong MCU rejected before any write", async () => {
  const port = mockPort({ signature: [15, 149, 30] });
  const avr = new Avr109(port);
  await avr.open();
  await assert.rejects(avr.identify(), /not ATmega32U4/);
  assert.ok(port.commands.every(c => c[0] !== 66));
  await avr.close();
});
test("readback corruption is reported as failure", async () => {
  const avr = new Avr109(mockPort({ corruptRead: true }));
  await avr.open();
  await avr.writePage(0, image.bytes.slice(0, PAGE_SIZE));
  await assert.rejects(avr.verifyPage(0, image.bytes.slice(0, PAGE_SIZE)), /verification failed/);
  await avr.close();
});
test("writes cannot reach bootloader area", async () => {
  const port = mockPort();
  const avr = new Avr109(port);
  await avr.open();
  await assert.rejects(avr.writePage(APP_LIMIT, new Uint8Array(PAGE_SIZE)), /Invalid page address/);
  await assert.rejects(avr.writePage(0, new Uint8Array(127)), /Invalid page size/);
  await avr.close();
});
test("timed out read is cancelled and port closes", async () => {
  const port = mockPort({ silent: true });
  const avr = new Avr109(port);
  await avr.open();
  await assert.rejects(avr.read(1, 15), /timeout/);
  await avr.close();
  assert.ok(port.closed);
});
