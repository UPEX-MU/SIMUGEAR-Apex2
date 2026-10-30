# SIMUGEAR Apex2

Dedicated Web Serial firmware flasher for SIMUGEAR Apex2.

- Device: ATmega32U4, AVR109 bootloader, USB VID `358F`, PID `288D`.
- Source export: `01_ColorPalette.ino.arduino_leonardo.hex`, supplied 2026-10-30.
- Firmware SHA-256: `DB4FA52BC11DBEC000C119A7C5BEFEDE791DCB9F607A9DB1433AF22591D3FF3D`.
- The exported HEX is copied without modification. No firmware recompilation or source changes are included.
- Only application flash below 28672 bytes is writable. No bootloader, EEPROM, fuse, or lock-bit writes.
- Browser checks the HEX hash, record checksums, target MCU signature, and each written page by readback.

Use desktop Chrome or Edge over HTTPS. Close SimHub and other serial applications first. Select the device, enter bootloader mode, then select the new bootloader port. Existing bootloader mode is available through the recovery button. The bootloader itself cannot distinguish product models; confirm the selected physical device is SIMUGEAR Apex2.

Update both `firmware.hex` and `FIRMWARE_SHA256` in `app.js` together for future releases. Preserve the `-text` Git attribute for HEX files.

Run automated checks with `node --test tests/*.test.js`. Browser/serial simulations do not replace real-device acceptance.
