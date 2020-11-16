import bp from "binary-parser";
import { readFile, writeFile } from "fs";
import { parse, format } from "path";

const { Parser } = bp;

const [src, dstDir] = process.argv.slice(2);

// logger sets FS_SEL to 3: range is ±2000°/s, sensitivity is 16.4°/s
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
  .uint16("overruns")
  .array("readings", {
    type: mpuReading,
    length: 31,
  })
  .seek(12);

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

  const stat = parsed.blocks.reduce((acc, block) => {
    acc.count += block.count;
    acc.overruns += block.overruns;
    return acc;
  }, { count: 0, overruns: 0 });

  console.log(`length: ${stat.count / RATE} sec`);
  console.log(`overruns: ${stat.overruns}`);

  const out = {
    frequency: RATE,
    angular_velocity_rad_per_sec: parsed.blocks.map((block) =>
      block.readings.slice(0, block.count).reduce((acc, item) => {
        const { gx, gy, gz } = item;

        acc.push(...[gx, gy, gz].map(convertRawToRadiansPerSecond));

        return acc;
      }, [])
    ),
  };

  const resPath = format({
    dir: dstDir,
    name: pathObject.name,
    ext: '.json'
  });

  console.log(`Writing to ${resPath}`);

  writeFile(resPath, JSON.stringify(out), function (err) {
    console.log(`Success!`)
    if (err) {
      return console.log(err);
    }
  });
});
