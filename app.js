import { Avr109, PAGE_SIZE, parseHex } from "./avr109.js";

const FIRMWARE_SHA256 = "DB4FA52BC11DBEC000C119A7C5BEFEDE791DCB9F607A9DB1433AF22591D3FF3D";
const DEVICE = { usbVendorId: 0x358f, usbProductId: 0x288d };
const $ = id => document.getElementById(id);
let normalPort = null;
let firmware = null;
let busy = false;
let bootReady = false;
const supported = isSecureContext && "serial" in navigator;

function log(message) {
  $("log").textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`;
  $("log").scrollTop = $("log").scrollHeight;
}

function progress(percent, message) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $("progressBar").style.width = `${value}%`;
  $("progressPercent").textContent = `${value}%`;
  $("progressText").textContent = message;
  $("progress").setAttribute("aria-valuenow", value);
}

function refreshControls() {
  const ready = supported && firmware && !busy;
  $("connectBtn").disabled = !ready;
  $("bootBtn").disabled = !ready || !normalPort;
  $("bootSelectBtn").disabled = !ready || !bootReady;
  $("recoveryBtn").disabled = !ready;
}

function errorMessage(error) {
  if (error.name === "NotFoundError") return "\u5df2\u53d6\u6d88\u4e32\u53e3\u9009\u62e9";
  return error.message;
}

$("connectBtn").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  refreshControls();
  try {
    const port = await navigator.serial.requestPort({ filters: [DEVICE] });
    const info = port.getInfo();
    if (info.usbVendorId !== DEVICE.usbVendorId || info.usbProductId !== DEVICE.usbProductId) throw new Error("Not a SIMUGEAR Apex2 device");
    normalPort = port;
    bootReady = false;
    $("deviceStatus").textContent = "SIMUGEAR Apex2 \u5df2\u9009\u62e9";
    progress(0, "\u8bbe\u5907\u5df2\u9009\u62e9");
    log("SIMUGEAR Apex2 (358F:288D) \u5df2\u9009\u62e9");
  } catch (error) {
    log(errorMessage(error));
  } finally {
    busy = false;
    refreshControls();
  }
});

$("bootBtn").addEventListener("click", async () => {
  if (busy || !normalPort || !firmware) return;
  busy = true;
  refreshControls();
  progress(0, "\u6b63\u5728\u8fdb\u5165\u5237\u5199\u6a21\u5f0f");
  const port = normalPort;
  try {
    await port.open({ baudRate: 1200 });
    await port.setSignals({ dataTerminalReady: false });
    await new Promise(resolve => setTimeout(resolve, 250));
    await port.close();
    normalPort = null;
    bootReady = true;
    $("deviceStatus").textContent = "\u7b49\u5f85 Bootloader \u4e32\u53e3";
    progress(0, "\u8bf7\u9009\u62e9\u65b0\u51fa\u73b0\u7684\u5237\u5199\u4e32\u53e3");
    log("\u5df2\u53d1\u9001 1200 baud \u91cd\u542f\u547d\u4ee4\uff0c\u7b49\u5f85 Arduino Leonardo Bootloader \u4e32\u53e3");
  } catch (error) {
    try { await port.close(); } catch {}
    progress(0, "\u8fdb\u5165\u5237\u5199\u6a21\u5f0f\u5931\u8d25");
    log(errorMessage(error));
  } finally {
    busy = false;
    refreshControls();
  }
});

async function flash() {
  if (busy || !firmware) return;
  busy = true;
  refreshControls();
  let avr;
  try {
    const port = await navigator.serial.requestPort();
    if (!window.confirm("\u786e\u8ba4\u6240\u9009 Bootloader \u4e32\u53e3\u5c5e\u4e8e SIMUGEAR Apex2\uff1f\u8bf7\u52ff\u5bf9\u5176\u4ed6\u578b\u53f7\u5199\u5165\u6b64\u56fa\u4ef6\u3002")) return;
    avr = new Avr109(port);
    await avr.open();
    progress(0, "\u6821\u9a8c\u82af\u7247\u4e2d");
    log(`Bootloader: ${await avr.identify()} / ATmega32U4`);
    const pages = firmware.size / PAGE_SIZE;
    for (let i = 0; i < pages; i++) {
      const address = i * PAGE_SIZE;
      const page = firmware.bytes.slice(address, address + PAGE_SIZE);
      await avr.writePage(address, page);
      await avr.verifyPage(address, page);
      progress((i + 1) / pages * 99, `\u5199\u5165\u5e76\u6821\u9a8c ${i + 1} / ${pages}`);
    }
    await avr.leave();
    normalPort = null;
    bootReady = false;
    progress(100, "\u5237\u5199\u5b8c\u6210\uff0c\u6821\u9a8c\u901a\u8fc7");
    $("deviceStatus").textContent = "SIMUGEAR Apex2 \u56fa\u4ef6\u5df2\u5199\u5165";
    log("\u6240\u6709\u9875\u9762\u56de\u8bfb\u6821\u9a8c\u901a\u8fc7\u3002\u8bf7\u91cd\u65b0\u63d2\u62d4 USB\u3002");
  } catch (error) {
    progress(0, "\u672a\u5b8c\u6210\u5237\u5199");
    log(errorMessage(error));
    log("\u82e5 Bootloader \u5df2\u8d85\u65f6\uff0c\u8bf7\u91cd\u65b0\u8fdb\u5165\u5237\u5199\u6a21\u5f0f\u540e\u91cd\u8bd5\u3002");
  } finally {
    await avr?.close();
    busy = false;
    refreshControls();
  }
}

$("bootSelectBtn").addEventListener("click", flash);
$("recoveryBtn").addEventListener("click", flash);
$("downloadLogBtn").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([$("log").textContent], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "SIMUGEAR-Apex2-flash-log.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function init() {
  $("supportStatus").textContent = supported ? "Web Serial \u5c31\u7eea" : "\u8bf7\u4f7f\u7528\u7535\u8111\u7248 Chrome / Edge";
  $("supportStatus").className = supported ? "ok" : "bad";
  try {
    const response = await fetch("./firmware.hex", { cache: "no-store" });
    if (!response.ok) throw new Error(`Firmware HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    if (hash !== FIRMWARE_SHA256) throw new Error("Firmware SHA-256 mismatch; update blocked");
    firmware = parseHex(new TextDecoder().decode(buffer));
    $("firmwareInfo").textContent = `${firmware.maxAddress.toLocaleString()} bytes`;
    progress(0, "\u56fa\u4ef6\u5df2\u5c31\u7eea");
    log("SIMUGEAR Apex2 / 2026.10.30 / application-only HEX");
    log(`SHA-256: ${hash}`);
    log("\u56fa\u4ef6\u6821\u9a8c\u901a\u8fc7");
  } catch (error) {
    $("firmwareInfo").textContent = "\u6821\u9a8c\u5931\u8d25";
    progress(0, "\u56fa\u4ef6\u52a0\u8f7d\u5931\u8d25");
    log(errorMessage(error));
  }
  refreshControls();
}

init();
