#!/usr/bin/env node

import bp from "binary-parser";
import { readFile, writeFile } from "fs";
import { parse, format } from "path";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const { Parser } = bp;

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <source> [<destination>]')
  .demandCommand(1)
  .hide('help')
  .hide('version')
  .argv

const [src, dst] = argv._;

// logger sets FS_SEL to 3: range is ±2000°/s, sensitivity is 16.4°/s
const GYRO_SCALE = 16.4; 

const convertRawToRadiansPerSecond = (raw) => (raw / GYRO_SCALE) * (Math.PI / 180);

const mpuReading = new Parser()
  .endianess("little")
  .uint32("timestamp")
  .int16("gx")
  .int16("gy")
  .int16("gz");

const mpuBlock = new Parser()
  .endianess("little")
  .uint16("count")
  .uint16("overruns")
  .array("readings", {
    type: mpuReading,
    length: 50,
  })
  .seek(8);

const mpuRawStream = new Parser()
  .endianess("little")
  .array("blocks", {
    type: mpuBlock,
    readUntil: "eof",
  });

console.log(`Reading raw data from ${src}`);

readFile(src, function (err, data) {
  if (err) {
    return console.log(err);
  }

  const srcPathObject = parse(src);

  const parsed = mpuRawStream.parse(data);

  const stat = parsed.blocks.reduce((acc, block) => {
    acc.count += block.count;
    acc.overruns += block.overruns;
    acc.timestamps.push(...block.readings.slice(0, block.count).map(r => r.timestamp));

    return acc;
  }, { count: 0, overruns: 0, timestamps: [] });

  const latencyStat = stat.timestamps.reduce(
    (acc, reading, index) => {
      if (index) {
        const frameLatency = reading - stat.timestamps[index -1];
        acc.sum += frameLatency;
        acc.min = acc.min ? Math.min(acc.min, frameLatency) : frameLatency;
        acc.max = acc.max ? Math.max(acc.max, frameLatency) : frameLatency;
      }

      return acc;
    },
    {min: null, max: null, sum: 0}
  );
  
  const avgLatency = latencyStat.sum / stat.count;
  const frequency = 1e6 / avgLatency;

  console.log(`length: ${stat.count / frequency} sec`);
  console.log(`latency: avg ${avgLatency} us, min ${latencyStat.min} us, max ${latencyStat.max} us`);
  console.log(`avg frequency: ${frequency} Hz`);

  if (stat.overruns) {
    console.log(`Warning! ${stat.overruns} overruns detected. Check logger configuration`);
  }

  const out = {
    frequency,
    angular_velocity_rad_per_sec: parsed.blocks.map((block) =>
      block.readings.slice(0, block.count).reduce((acc, item) => {
        const { gx, gy, gz } = item;

        acc.push(...[gx, gy, gz].map(convertRawToRadiansPerSecond));

        return acc;
      }, [])
    ),
  };

  const dstPathObject = parse(dst);

  const resPath = format({
    dir: dstPathObject.dir,
    name: dstPathObject.name || srcPathObject.name,
    ext: dstPathObject.ext || '.json'
  });

  writeFile(resPath, JSON.stringify(out), function (err) {
    console.log(`Successfully written to ${resPath}`);

    if (err) {
      return console.log(err);
    }
  });
});
