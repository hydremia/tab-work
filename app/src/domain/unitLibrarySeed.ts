/**
 * The unit configurations researched for the static-profile order (2026-10-09, docs: "Unit Static Profile Component
 * Order: Research Findings"): product lines of Carrier, York, Lennox, Trane, Addison, Munters and CaptiveAire with
 * their supply-air component order, how it is known and the documents that show it. Offered on the Library page as a
 * starting set; every entry can be edited, and "inferred" / "unconfirmed" ones are to be checked against the drawings.
 * The quotes come from search extracts of the documents (the pages could not be opened from the research environment).
 */
import type { LibraryUnit, UnitComponent } from '../data/types';

export type SeedUnit = Omit<LibraryUnit, 'id' | 'createdAt' | 'updatedAt'>;

const c = (kind: UnitComponent['kind'], label?: string, optional?: boolean): UnitComponent => ({
  kind,
  ...(label ? { label } : {}),
  ...(optional ? { optional: true } : {}),
});

/** Packaged rooftop: draw-through cooling coil, reheat after the coil, blow-through heat. */
const RTU_ORDER = (reheat: string): UnitComponent[] => [
  c('damper', 'Economizer / OA-RA dampers', true),
  c('filter'),
  c('coil', 'Evaporator coil'),
  c('reheat', reheat, true),
  c('fan', 'Supply fan'),
  c('heat', 'Gas heat exchanger / electric heat'),
];

export const UNIT_LIBRARY_SEED: readonly SeedUnit[] = [
  {
    make: 'Carrier, Bryant',
    line: 'WeatherMaker 48TC / 48HC, WeatherExpert 48LC',
    modelPatterns: '48TC*, 48HC*, 48LC*',
    unitType: 'RTU',
    components: RTU_ORDER('Humidi-MiZer reheat coil'),
    confidence: 'stated',
    evidence:
      'Product data: "All units are draw-through in cooling mode and blow-through in heating mode." Humidi-MiZer manual: "a common subcooling/reheat dehumidification coil located downstream (with respect to airflow) of the standard evaporator coil." (48LC: stated for sizes 14-26.)',
    documents: [
      {
        title: '48TC product data',
        kind: 'productData',
        ref: '48TC-16pd',
        url: 'https://americancoolingandheating.com/wp-content/uploads/carrier-product-data-specifications/48TC-16pd.pdf',
      },
      {
        title: '48HC product data',
        kind: 'productData',
        ref: '48hc-11pd',
        url: 'https://www.americancoolingandheating.com/wp-content/uploads/carrier-product-data-specifications/48hc-11pd.pdf',
      },
      {
        title: '48LC 14-26 product data',
        kind: 'productData',
        ref: '48LC-14-26-05PD Rev B',
        url: 'https://www.shareddocs.com/hvac/docs/1005/Public/0D/48LC-14-26-05PD.pdf',
      },
      { title: '48/50TC, 48/50HC Humidi-MiZer manual', kind: 'manual', ref: '48-50TCHC-01XA' },
    ],
    notes: '',
  },
  {
    make: 'Carrier',
    line: 'WeatherMaster 48GE',
    modelPatterns: '48GE*',
    unitType: 'RTU',
    components: RTU_ORDER('Humidi-MiZer reheat coil'),
    confidence: 'inferred',
    evidence:
      'No airflow sentence found for the 48GE; order taken from the 48TC/48HC/48LC family ("draw-through in cooling mode and blow-through in heating mode"). Direct-drive EcoBlue vane-axial fan.',
    documents: [
      {
        title: '48/50GE 17-28 product data',
        kind: 'productData',
        ref: '48-50GE-17-28-01PD',
        url: 'https://www.shareddocs.com/hvac/docs/1005/Public/09/48-50GE-17-28-01PD.pdf',
      },
      {
        title: '48/50GE 04-06 product data',
        kind: 'productData',
        ref: '48-50GE-4-6-01PD',
        url: 'https://www.shareddocs.com/hvac/docs/1005/Public/0A/48-50GE-4-6-01PD.pdf',
      },
      {
        title: '48GE 04-06 installation instructions',
        kind: 'manual',
        ref: '48GE-4-6-01SI',
        url: 'https://www.shareddocs.com/hvac/docs/1005/Public/0E/48GE-4-6-01SI.pdf',
      },
    ],
    notes:
      'Model position 5 = heat: D/E/F low/medium/high, G/H ultra-low-NOx low/medium, L low-NOx low, S/R/T stainless low/medium/high. Position 6 N = two-stage cooling, single circuit, with Humidi-MiZer (reheat coil in the path).',
  },
  {
    make: 'Carrier',
    line: 'WeatherMaker 48FC / 48FE, 48A, 48N',
    modelPatterns: '48FC*, 48FE*, 48GC*, 48A*, 48N*',
    unitType: 'RTU',
    components: RTU_ORDER('Humidi-MiZer reheat coil'),
    confidence: 'unconfirmed',
    evidence: 'No airflow statement found; assumed to follow the 48TC/48HC family. Check the product data.',
    documents: [
      { title: '48/50FC 08-16 product data', kind: 'productData', ref: '48-50FC-8-16-01PD' },
      { title: '48/50FE product data', kind: 'productData', ref: '48-50FE-8-16-01PD' },
      { title: '48/50A product data', kind: 'productData', ref: '48/50A-18PD' },
      { title: '48/50N product data', kind: 'productData', ref: '48-50N-6PD' },
    ],
    notes: '',
  },
  {
    make: 'York, Johnson Controls',
    line: 'Sun Premier 25-80 ton',
    modelPatterns: '',
    unitType: 'RTU',
    components: [
      c('damper', 'Economizer', true),
      c('filter'),
      c('coil', 'Evaporator coil'),
      c('reheat', 'Hot gas reheat coil', true),
      c('fan', 'Direct drive plenum supply fan'),
      c('heat', 'Modulating or staged gas heat'),
      c('finalFilter', 'Final filter', true),
    ],
    confidence: 'stated',
    evidence:
      'Cabinet figure legend: "1 Economizer, 2 Evaporator coil, 3 Direct drive plenum (DDP) supply fan, 4 Modulating or staged gas heat … 10 Filter section … 13 Final filter."',
    documents: [
      {
        title: 'Sun Premier installation manual',
        kind: 'manual',
        ref: '5586991-YIM-A-520',
        url: 'https://files.hvacnavigator.com/p/5586991-yim-a.pdf',
      },
      {
        title: 'Sun Premier start-up guide',
        kind: 'manual',
        ref: '5587001-YSG-A-520',
        url: 'https://files.hvacnavigator.com/p/5587001-ysg-a.pdf',
      },
      {
        title: 'Sun Premier technical guide',
        kind: 'productData',
        ref: '5514889-YTG-A-0122',
        url: 'https://files.hvacnavigator.com/p/5514889-ytg-a.pdf',
      },
    ],
    notes: 'Add the Sun Premier model prefix to Model patterns when known.',
  },
  {
    make: 'York, Johnson Controls',
    line: 'YPAL / YRK 50-150 ton',
    modelPatterns: 'YPAL*, YRK*',
    unitType: 'RTU',
    components: [
      c('damper', 'Economizer', true),
      c('filter'),
      c('coil', 'Evaporator coil'),
      c('reheat', 'Modulating hot gas reheat coil', true),
      c('fan', 'Supply fan'),
      c('heat', 'Furnace (discharge plenum)'),
    ],
    confidence: 'stated',
    evidence:
      '"The furnace is located in the discharge plenum, downstream of the supply fan." "Modulating HGRH … separate coil downstream of the evaporator cooling coil."',
    documents: [
      {
        title: 'YRK engineering guide',
        kind: 'productData',
        ref: 'YRK1-EG1',
        url: 'https://files.hvacnavigator.com/p/yrk1-eg1.pdf',
      },
    ],
    notes: '',
  },
  {
    make: 'York, Johnson Controls',
    line: 'Predator, Sun Pro, ZE/XN, ZJ/ZR/ZF 3-25 ton',
    modelPatterns: 'ZH*, ZJ*, ZR*, ZF*, ZE*, XN*, XP*',
    unitType: 'RTU',
    components: RTU_ORDER('Hot gas reheat coil (MagnaDRY)'),
    confidence: 'inferred',
    evidence:
      'Evaporator "direct expansion, draw-thru design"; electric heat "mounted at the discharge of the supply air blower". Gas heat after the blower is inferred (blower tables include the heat exchanger; exchanger tilted to drain in cooling).',
    documents: [
      { title: 'Predator technical guide', kind: 'productData', ref: '5167795-YTG-O-0120' },
      { title: 'ZR installation manual', kind: 'manual', ref: '5167531-YIM-J-1019' },
      { title: 'ZF with Smart Equipment installation manual', kind: 'manual', ref: '5287207-YIM-G-0119' },
      { title: 'ZE/XN technical guide', kind: 'productData', ref: '5190086-YTG-G-1119' },
    ],
    notes: 'York dry-coil airflow check: pressure drop across the indoor coil through the two 5/16" dot plugs.',
  },
  {
    make: 'Lennox',
    line: 'Energence / Landmark, Model L, Raider, Strategos',
    modelPatterns: 'LGH*, LCH*, LGM*, LCM*, ZGA*, ZGB*, ZGC*, ZGD*, ZCA*, ZCB*, KGA*, KGB*, KCB*',
    unitType: 'RTU',
    components: RTU_ORDER('Humiditrol reheat coil'),
    confidence: 'inferred',
    evidence:
      'Service literature: "The supply air blower forces air across the tubes to extract the heat of combustion." Humiditrol: "reheat coil adjacent to and downstream of the evaporator coil."',
    documents: [
      {
        title: 'LGH 3-6 ton service literature',
        kind: 'manual',
        ref: '0924-L11',
        url: 'https://www.lennox.com/dA/08178a7baa/0924e.pdf',
      },
      {
        title: 'ZGA/ZGB service literature',
        kind: 'manual',
        ref: '1401-L4',
        url: 'https://www.lennox.com/dA/3e68d70bff/1401b.pdf',
      },
      {
        title: 'LGM service literature',
        kind: 'manual',
        ref: '100036',
        url: 'https://www.lennox.com/dA/7badeab555/100036.pdf',
      },
      { title: 'LGH/LCH 036-072 installation manual', kind: 'manual', ref: '507410-07a' },
    ],
    notes: 'Lennox reads external static "from supply to return" at the locations in the installation manual figure.',
  },
  {
    make: 'Lennox',
    line: 'Xion, Enlight',
    modelPatterns: 'LGX*, LCX*, LGT*, LCT*, LHT*',
    unitType: 'RTU',
    components: RTU_ORDER('Humiditrol reheat coil'),
    confidence: 'unconfirmed',
    evidence: 'No airflow text found; assumed to follow the other Lennox lines.',
    documents: [
      {
        title: 'LGX/LCX 7.5-12.5 ton installation manual',
        kind: 'manual',
        ref: '508513-01',
        url: 'https://www.lennox.com/dA/11914fe192/508513-01.pdf',
      },
    ],
    notes: '',
  },
  {
    make: 'Trane, American Standard',
    line: 'Precedent, Voyager',
    modelPatterns: 'YSC*, YHC*, TSC*, THC*, YCD*, YCH*, YHH*',
    unitType: 'RTU',
    components: RTU_ORDER('Hot gas reheat coil'),
    confidence: 'inferred',
    evidence:
      '"The evaporator is a draw-thru configuration." Heat after the fan is inferred (not stated in the extracts found).',
    documents: [
      { title: 'Precedent gas/electric IOM', kind: 'manual', ref: 'RT-SVX21R-EN' },
      { title: 'Precedent product catalog', kind: 'productData', ref: 'RT-PRC107B-EN' },
      { title: 'Voyager IOM', kind: 'manual', ref: 'RT-SVX48E-EN' },
    ],
    notes: '',
  },
  {
    make: 'Trane',
    line: 'IntelliPak, Voyager 3, Foundation',
    modelPatterns: 'GBC*, GBH*, GDK*',
    unitType: 'RTU',
    components: RTU_ORDER('Hot gas reheat coil'),
    confidence: 'inferred',
    evidence:
      'Heating capacity example: "Air temperature entering heating module = 63.0 + 2.73 = 65.7°F" (mixed air plus supply-fan heat), so the heat is after the fan.',
    documents: [
      { title: 'IntelliPak IOM', kind: 'manual', ref: 'RT-SVX36N-EN' },
      { title: 'IntelliPak 2 IOM', kind: 'manual', ref: 'RT-SVX072E-EN' },
      { title: 'Foundation IOM', kind: 'manual', ref: 'RT-SVX095C-EN' },
    ],
    notes: 'Add the IntelliPak and Voyager 3 model prefixes to Model patterns when known.',
  },
  {
    make: 'Addison',
    line: 'PR / PRAK DOAS',
    modelPatterns: 'PR*',
    unitType: 'DOAS',
    components: [
      c('damper', 'OA damper / wheel bypass', true),
      c('filter'),
      c('wheel', 'Energy recovery wheel', true),
      c('coil', 'Evaporator coil'),
      c('reheat', 'Subcooling / hot gas reheat coil', true),
      c('fan', 'Direct-drive supply fan'),
      c('heat', 'Gas furnace / electric heater'),
    ],
    confidence: 'inferred',
    evidence:
      'Brochure: "sub-cooling coil is to be installed downstream of the evaporator, and the reheat coil downstream of the sub-cooling coil"; "Gas furnace/electric heater (not shown) are located below direct-drive supply fan"; wheel "pre-conditioning of evaporator inlet air". Filter position relative to the wheel not confirmed.',
    documents: [
      {
        title: 'PR IOM',
        kind: 'manual',
        ref: '2025/07',
        url: 'https://www.addison-hvac.com/wp-content/uploads/2025/07/Addison-PR-IOM.pdf',
      },
      {
        title: 'PR brochure',
        kind: 'productData',
        ref: 'ADPRFNA Rev C',
        url: 'https://www.rg-cloud.com/AD/ADPRFNA_RevC.pdf',
      },
      { title: 'PR start-up form', kind: 'other' },
    ],
    notes: '',
  },
  {
    make: 'Munters',
    line: 'DryCool HCUc / Standard (desiccant)',
    modelPatterns: 'HCUC*, HCU*',
    unitType: 'DHU',
    components: [
      c('damper', 'OA / RA dampers', true),
      c('filter'),
      c('coil', 'DX pre-cooling coil'),
      c('desiccant', 'Desiccant wheel (process side)'),
      c('fan', 'Supply fan'),
      c('heat', 'Post-heat', true),
    ],
    confidence: 'inferred',
    evidence:
      'Catalog: air leaves the DX coil "at or near saturation. This is where the desiccant wheel functions most efficiently." HCUb manual: "Supply air is pulled through the wheel by fan." Post-heat position not confirmed.',
    documents: [
      {
        title: 'DryCool Standard System engineering catalog',
        kind: 'productData',
        url: 'https://webdh.munters.com/webdh/BrochureUploads/Engineering%20Catalog-%20DryCool%20Standard%20System.pdf',
      },
      {
        title: 'DryCool rental HCUb manual',
        kind: 'manual',
        ref: 'HCUB60304-HMXC, May 2017',
        url: 'https://www.munters.com/globalassets/digizuite/24331-en-drycool-rental-om-um-en-201712.pdf',
      },
      {
        title: 'DryCool HCUi product guide',
        kind: 'productData',
        url: 'https://webdh.munters.com/webdh/BrochureUploads/Product%20Guide-%20DryCool%20HCUi.pdf',
      },
    ],
    notes:
      'Model key: HCUc 80 = unit size (8,000 CFM), 40 = nominal tons, A = DX air-cooled packaged outdoor. Reactivation path: reactivation fan → condenser/reactivation coil → filter → wheel → exhaust.',
  },
  {
    make: 'CaptiveAire, Captive-Aire',
    line: 'Direct-fired make-up air (A-series D, D76)',
    modelPatterns: 'A?-D*, D76*',
    unitType: 'MAU',
    components: [
      c('filter', 'Intake filters'),
      c('burner', 'Direct-fired burner (draw-through)'),
      c('fan', 'Supply fan'),
    ],
    confidence: 'stated',
    evidence:
      'Specification: the burner is "a direct fired, draw through type"; the heat module attaches "to blower intake". D76 manual: airflow switch reads the pressure drop across the burner.',
    documents: [
      {
        title: 'CAH/CAV specification',
        kind: 'productData',
        url: 'https://www.captiveaire.com/CatalogContent/Fans/sup_cfa/cav_cavm_specification.asp',
      },
      {
        title: 'Standard and modular direct fired heaters manual',
        kind: 'manual',
        ref: 'A0011030 Rev. 37, June 2021',
        url: 'https://www.captiveaire.com/manuals/makeupair/direct-heater-oim.pdf',
      },
      {
        title: 'D76 specification',
        kind: 'productData',
        url: 'https://www.captiveaire.com/CATALOGCONTENT/FANS/SUP_76/76_SPECIFICATION.ASP?catId=288&Model=D76',
      },
    ],
    notes: 'A2-D.250-20D: size 2 housing, direct gas-fired, 20" mixed-flow direct-drive fan.',
  },
  {
    make: 'Seasons-4, Seasons 4',
    line: 'Custom DOAS / dehumidification (Dual Path, ERU, Classic)',
    modelPatterns: '',
    unitType: 'DOAS',
    components: null,
    confidence: 'unconfirmed',
    evidence:
      "Custom units: no IOM or section drawing found. Dual Path brochure: an outdoor-air pre-cool coil ahead of a two-stage dehumidification coil, then mixing with return air. Use each job's submittal.",
    documents: [
      {
        title: 'Dual Path brochure',
        kind: 'productData',
        url: 'https://seasons4.net/wp-content/uploads/2012/06/Seasons-4-Dual-Path-brochure.pdf',
      },
      {
        title: 'Energy Recovery Systems brochure',
        kind: 'productData',
        url: 'https://seasons4.net/wp-content/uploads/2012/07/ERU-SYSTEMS.pdf',
      },
    ],
    notes: 'Factory: 770-489-0716.',
  },
];
