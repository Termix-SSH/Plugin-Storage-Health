const sda = {
  device: { name: "/dev/sda", type: "sat" },
  model_name: "WDC WD40EFRX-68N32N0",
  serial_number: "WD-ABC123",
  user_capacity: { bytes: 4000787030016 },
  rotation_rate: 5400,
  smart_status: { passed: true },
  temperature: { current: 38 },
  power_on_time: { hours: 41000 },
  ata_smart_attributes: {
    table: [
      { id: 5, name: "Reallocated_Sector_Ct", value: 200, raw: { value: 0 } },
      {
        id: 197,
        name: "Current_Pending_Sector",
        value: 200,
        raw: { value: 8 },
      },
      { id: 198, name: "Offline_Uncorrectable", value: 200, raw: { value: 0 } },
    ],
  },
  ata_smart_self_test_log: {
    standard: {
      table: [
        {
          type: { string: "Short offline" },
          status: { string: "Completed without error" },
        },
      ],
    },
  },
};

const sdb = {
  device: { name: "/dev/sdb", type: "sat" },
  model_name: "Samsung SSD 860 EVO",
  serial_number: "S3Z9",
  user_capacity: { bytes: 500107862016 },
  rotation_rate: 0,
  smart_status: { passed: false },
  temperature: { current: 44 },
  power_on_time: { hours: 20000 },
  ata_smart_attributes: {
    table: [
      { id: 5, name: "Reallocated_Sector_Ct", value: 90, raw: { value: 120 } },
      { id: 177, name: "Wear_Leveling_Count", value: 96, raw: { value: 40 } },
    ],
  },
};

const nvme = {
  device: { name: "/dev/nvme0n1", type: "nvme" },
  model_name: "Samsung SSD 980 PRO 1TB",
  serial_number: "S5GX",
  user_capacity: { bytes: 1000204886016 },
  smart_status: { passed: true },
  temperature: { current: 52 },
  power_on_time: { hours: 3100 },
  nvme_smart_health_information_log: {
    critical_warning: 0,
    temperature: 52,
    available_spare: 100,
    available_spare_threshold: 10,
    percentage_used: 3,
    media_errors: 0,
    power_on_hours: 3100,
  },
};

const asleep = {
  smartctl: {
    messages: [{ string: "Device is in STANDBY mode, exit(2)" }],
    exit_status: 2,
  },
};

const LSBLK = {
  blockdevices: [
    {
      name: "sda",
      type: "disk",
      size: 4000787030016,
      model: "WDC WD40EFRX",
      serial: "WD-ABC123",
      rota: true,
      tran: "sata",
    },
    {
      name: "sdb",
      type: "disk",
      size: 500107862016,
      model: "Samsung SSD 860",
      serial: "S3Z9",
      rota: false,
      tran: "sata",
    },
    {
      name: "sdc",
      type: "disk",
      size: 8001563222016,
      model: "ST8000",
      serial: "Z84",
      rota: true,
      tran: "sata",
    },
    {
      name: "nvme0n1",
      type: "disk",
      size: 1000204886016,
      model: "Samsung 980 PRO",
      serial: "S5GX",
      rota: false,
      tran: "nvme",
    },
  ],
};

export const ZPOOL_LIST =
  "tank\t7999000000000\t4000000000000\t3999000000000\tDEGRADED\n";

export const ZPOOL_STATUS = `  pool: tank
 state: DEGRADED
status: One or more devices could not be opened.
  scan: scrub repaired 0B in 05:12:41 with 0 errors on Sun Nov  1 05:36:41 2026
config:

\tNAME        STATE     READ WRITE CKSUM
\ttank        DEGRADED     0     0     0
\t  mirror-0  DEGRADED     0     0     0
\t    sdc     ONLINE       0     0     0
\t    sdd     UNAVAIL      0     0     0  cannot open

errors: No known data errors
`;

export const MDSTAT = `Personalities : [raid1] [raid6]
md0 : active raid1 sdb1[1] sda1[0](F)
      1046528 blocks super 1.2 [2/1] [_U]
      [=>...................]  recovery =  8.4% (88000/1046528) finish=2.1min speed=7500K/sec

md1 : active raid6 sde[0] sdf[1] sdg[2] sdh[3]
      2095104 blocks super 1.2 level 6, 512k chunk [4/4] [UUUU]

unused devices: <none>
`;

export const BTRFS_STATS = `[/dev/sdc1].write_io_errs    0
[/dev/sdc1].read_io_errs     0
[/dev/sdc1].flush_io_errs    0
[/dev/sdc1].corruption_errs  3
[/dev/sdc1].generation_errs  0
`;

export const BTRFS_SCRUB = `UUID:             1111
Scrub started:    Sun Nov  1 02:00:01 2026
Status:           finished
Duration:         1:02:03
Error summary:    csum=3
  Corrected:      3
  Uncorrectable:  0
`;

export const LVS = JSON.stringify({
  report: [
    {
      lv: [
        {
          lv_name: "thinpool",
          vg_name: "vg0",
          lv_attr: "twi-aotz--",
          lv_size: "100000000000",
          data_percent: "93.50",
          metadata_percent: "12.00",
        },
        {
          lv_name: "root",
          vg_name: "vg0",
          lv_attr: "-wi-ao----",
          lv_size: "20000000000",
          data_percent: "",
          metadata_percent: "",
        },
      ],
    },
  ],
});

export const VGS = JSON.stringify({
  report: [
    {
      vg: [{ vg_name: "vg0", vg_size: "200000000000", vg_free: "20000000000" }],
    },
  ],
});

export const READ_OUTPUT = [
  "@@root 0",
  "@@tool smartctl",
  "@@tool lsblk",
  "@@tool zpool",
  "@@tool mdstat",
  "@@tool btrfs",
  "@@tool lvs",
  "@@lsblk",
  JSON.stringify(LSBLK),
  "@@smart sda",
  JSON.stringify(sda),
  "@@smart sdb",
  JSON.stringify(sdb),
  "@@smart sdc",
  JSON.stringify(asleep),
  "@@smart nvme0n1",
  JSON.stringify(nvme),
  "@@zlist",
  ZPOOL_LIST.trimEnd(),
  "@@zstatus",
  ZPOOL_STATUS,
  "@@mdstat",
  MDSTAT,
  "@@btrfs /mnt/data|data",
  BTRFS_STATS,
  "@@scrub",
  BTRFS_SCRUB,
  "@@lvs",
  LVS,
  "@@vgs",
  VGS,
  "@@end",
  "",
].join("\n");

/** Everything fine: one healthy NVMe and an online pool. */
export const READ_HEALTHY = [
  "@@root 0",
  "@@tool smartctl",
  "@@lsblk",
  JSON.stringify({ blockdevices: [LSBLK.blockdevices[3]] }),
  "@@smart nvme0n1",
  JSON.stringify(nvme),
  "@@end",
  "",
].join("\n");
