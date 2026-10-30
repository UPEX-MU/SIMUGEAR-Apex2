export const PAGE_SIZE = 128;
export const APP_LIMIT = 28672;

export function parseHex(text) {
  const memory = new Map();
  let upper = 0;
  let eof = false;
  for (const raw of text.trim().split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (eof || !/^:[0-9a-f]+$/i.test(line) || line.length < 11 || line.length % 2 !== 1) throw new Error("Invalid HEX record");
    const record = Uint8Array.from(line.slice(1).match(/../g), value => parseInt(value, 16));
    const [length, high, low, type] = record;
    if (record.length !== length + 5 || record.reduce((sum, n) => sum + n, 0) % 256 !== 0) throw new Error("HEX checksum or length mismatch");
    const address = high * 256 + low;
    if (type === 0) {
      if (upper + address + length > APP_LIMIT) throw new Error("HEX exceeds application area; bootloader images are not allowed");
      for (let i = 0; i < length; i++) {
        const target = upper + address + i;
        if (memory.has(target) && memory.get(target) !== record[4 + i]) throw new Error("Conflicting HEX data");
        memory.set(target, record[4 + i]);
      }
    } else if (type === 1 && length === 0 && address === 0) {
      eof = true;
    } else if (type === 4 && length === 2 && address === 0) {
      upper = (record[4] * 256 + record[5]) * 65536;
    } else {
      throw new Error("Unsupported HEX record");
    }
  }
  if (!eof || !memory.has(0) || memory.size < 2) throw new Error("Incomplete HEX image");
  const maxAddress = Math.max(...memory.keys()) + 1;
  const bytes = new Uint8Array(Math.ceil(maxAddress / PAGE_SIZE) * PAGE_SIZE).fill(255);
  for (const [address, value] of memory) bytes[address] = value;
  return { bytes, maxAddress, size: bytes.length };
}

export class Avr109 {
  constructor(port) {
    this.port = port;
    this.buffer = [];
  }

  async open() {
    await this.port.open({ baudRate: 57600, bufferSize: 4096 });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
  }

  async close() {
    try { await this.reader?.cancel(); } catch {}
    try { this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port.close(); } catch {}
  }

  async read(length, timeout = 2500) {
    const deadline = Date.now() + timeout;
    while (this.buffer.length < length) {
      let timer;
      try {
        const result = await Promise.race([
          this.reader.read(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Bootloader response timeout")), Math.max(1, deadline - Date.now())); })
        ]);
        if (result.done || !result.value?.length) throw new Error("Bootloader disconnected");
        this.buffer.push(...result.value);
      } catch (error) {
        try { await this.reader.cancel(); } catch {}
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    return Uint8Array.from(this.buffer.splice(0, length));
  }

  async write(data) { await this.writer.write(Uint8Array.from(data)); }

  async command(data) {
    await this.write(data);
    if ((await this.read(1))[0] !== 13) throw new Error("Bootloader rejected command");
  }

  async identify() {
    await this.write([83]);
    const id = new TextDecoder().decode(await this.read(7));
    await this.write([115]);
    const signature = await this.read(3);
    if (signature.join(",") !== "135,149,30") throw new Error("Chip is not ATmega32U4; nothing was written");
    await this.write([98]);
    const block = await this.read(3);
    if (block[0] !== 89 || block[1] * 256 + block[2] < PAGE_SIZE) throw new Error("Unsupported bootloader page size");
    return id;
  }

  async setAddress(address) {
    if (address < 0 || address >= APP_LIMIT || address % PAGE_SIZE !== 0) throw new Error("Invalid page address");
    const word = address / 2;
    await this.command([65, word >> 8, word & 255]);
  }

  async writePage(address, page) {
    if (page.length !== PAGE_SIZE) throw new Error("Invalid page size");
    await this.setAddress(address);
    await this.command([66, 0, PAGE_SIZE, 70, ...page]);
  }

  async verifyPage(address, page) {
    await this.setAddress(address);
    await this.write([103, 0, PAGE_SIZE, 70]);
    const actual = await this.read(PAGE_SIZE);
    if (actual.some((value, i) => value !== page[i])) throw new Error(`Flash verification failed at 0x${address.toString(16)}`);
  }

  async leave() { await this.command([69]); }
}
