import bp from "binary-parser";
import { readFile, writeFile } from "fs";
import { parse } from "path";

const { Parser } = bp;

const [src, dstDir] = process.argv.slice(2);

// logger sets FS_SEL to 3: range is ±2000°/s, sensitivity is 16.4 LSB/°/s
const GYRO_SCALE = 16.4; 
// logging rate in readings/s
const RATE = 500;

const convertRawToRadiansPerSecond = (raw) => (raw / GYRO_SCALE) * (Math.PI / 180);

const mpuReading = new Parser()
  .endianess("little")
  .uint32("timestamp")
  .int16("ax")
  .int16("ay")
  .int16("az")
  .int16("gx")
  .int16("gy")
  .int16("gz");

const mpuBlock = new Parser()
  .endianess("little")
  .uint16("count")
  .uint16("overrun")
  .array("readings", {
    type: mpuReading,
    length: 31,
  })
  .array("pad", {
    type: "uint8",
    lengthInBytes: 12,
  });

const mpuRawStream = new Parser()
  .endianess("little")
  .array("blocks", {
    type: mpuBlock,
    readUntil: "eof",
  });

readFile(src, function (err, data) {
  const pathObject = parse(src);

  console.log(`Reading raw data from ${src}`);

  const parsed = mpuRawStream.parse(data);

  console.log(
    `length: ${
      parsed.blocks.reduce((count, block) => count + block.readings.length, 0) /
      RATE
    } sec`
  );

  const out = {
    frequency: RATE,
    angular_velocity_rad_per_sec: parsed.blocks.map((block) =>
      block.readings.reduce((acc, item) => {
        const { gx, gy, gz } = item;

        acc.push(...[gx, gy, gz].map(convertRawToRadiansPerSecond));

        return acc;
      }, [])
    ),
  };

  const resPath = `${dstDir}/${pathObject.name}.json`;

  console.log(`Writing to ${resPath}`);
  
  writeFile(resPath, JSON.stringify(out), function (err) {
    console.log(`Success!`)
    if (err) {
      return console.log(err);
    }
  });
});
