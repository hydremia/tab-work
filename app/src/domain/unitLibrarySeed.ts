/**
 * The unit configurations researched for the static-profile order (2026-10-09, doc "Unit Static Profile Component
 * Order: Research Findings"): product lines of Carrier, York, Lennox, Trane, Addison, Munters, CaptiveAire and
 * Seasons-4 with their supply-air component order, how it is known and the documents that show it. Offered on the
 * Library page as a starting set; every entry can be edited.
 *
 * Confidence: "stated" = a sentence or a labelled figure in the manufacturer's document gives the order (page and
 * figure cited); "inferred" = the order follows from the documents (a drawing without words, a sister line, a
 * sensor note) but is not given outright; "unconfirmed" = no document shows it. The documents were read from the
 * manufacturers' PDFs (2026-10-09); the citations name the form number, page and figure.
 */
import type { LibraryUnit, UnitComponent } from '../data/types';

export type SeedUnit = Omit<LibraryUnit, 'id' | 'createdAt' | 'updatedAt'>;

const c = (kind: UnitComponent['kind'], label?: string, optional?: boolean): UnitComponent => ({
  kind,
  ...(label ? { label } : {}),
  ...(optional ? { optional: true } : {}),
});

/** Packaged rooftop: draw-through cooling coil, reheat after the coil, blow-through heat. */
const RTU_ORDER = (
  reheat: string,
  fan = 'Supply fan',
  heat = 'Gas heat exchanger / electric heat',
): UnitComponent[] => [
  c('damper', 'Economizer / OA-RA dampers', true),
  c('filter'),
  c('coil', 'Evaporator coil'),
  c('reheat', reheat, true),
  c('fan', fan),
  c('heat', heat),
];

const SHAREDDOCS = 'https://www.shareddocs.com/hvac/docs/1005/Public';
const ACH = 'https://americancoolingandheating.com/wp-content/uploads/carrier-product-data-specifications';
const NAV = 'https://files.hvacnavigator.com/p';
const TRANE = 'https://elibrary.tranetechnologies.com/public/commercial-hvac/Literature';
const LENNOX = 'https://www.lennox.com/dA';
const ADDISON = 'https://www.addison-hvac.com/wp-content/uploads';
const MUNTERS = 'https://webdh.munters.com/webdh/BrochureUploads';
const CAPTIVE = 'https://www.captiveaire.com';
const S4 = 'https://seasons4.net/wp-content/uploads';

const LENNOX_STATIC =
  'Lennox: "With all access panels in place, measure static pressure external to unit (from supply to return)", filters in, at the locations of the "Location of static pressure readings" figure (supply in the main duct run at the first branch, or at the diffuser; return in the return duct). Blower tables: base unit, dry coil and filters, no heat section; add the heat section, wet coil and economizer resistances.';

export const UNIT_LIBRARY_SEED: readonly SeedUnit[] = [
  // ---------------------------------------------------------------------------------------------------- Carrier
  {
    make: 'Carrier',
    line: 'WeatherMaster 48GE',
    modelPatterns: '48GE*',
    unitType: 'RTU',
    components: RTU_ORDER(
      'Humidi-MiZer reheat coil',
      'Vane-axial direct-drive indoor fan (EcoBlue)',
      'Gas heat exchanger',
    ),
    confidence: 'stated',
    evidence:
      '48-50GE-17-28-01PD p.130 (and 04-06 PD p.130, 07-14 PD p.155): "All units are draw-through in cooling mode and blow-through in heating mode." Cutaways (17-28 PD p.4, 04-06 PD p.3, 07-14 PD p.4): the vane-axial fan(s) sit on a deck directly above the gas heat exchanger. Humidi-MiZer: "a small reheat condenser coil downstream of the evaporator" (17-28 PD p.129). 48GE-4-6-01SI p.30: the leak sensor "is located between the indoor coil and the air filters". Reheat coil before the fan is inferred from draw-through cooling.',
    documents: [
      {
        title: '48/50GE 17-28 product data',
        kind: 'productData',
        ref: '48-50GE-17-28-01PD, 4-25',
        url: `${SHAREDDOCS}/09/48-50GE-17-28-01PD.pdf`,
      },
      {
        title: '48/50GE 07-14 product data',
        kind: 'productData',
        ref: '48-50GE-7-14-01PD Rev A, 8-25',
        url: `${SHAREDDOCS}/0E/48-50GE-7-14-01PD.pdf`,
      },
      {
        title: '48/50GE 04-06 product data',
        kind: 'productData',
        ref: '48-50GE-4-6-02PD, 4-26',
        url: `${SHAREDDOCS}/0D/48-50GE-4-6-02PD.pdf`,
      },
      {
        title: '48GE 04-06 installation instructions',
        kind: 'manual',
        ref: '48GE-4-6-01SI, 5-24',
        url: `${SHAREDDOCS}/0E/48GE-4-6-01SI.pdf`,
      },
    ],
    notes:
      'Model number (17-28 PD p.5, 04-06 PD p.4): 48 gas heat packaged rooftop · GE WeatherMaster · pos. 5 heat: D/E/F low/medium/high, G/H Ultra Low NOx low/medium (stainless HX), L low NOx low, S/R/T stainless low/medium/high · pos. 6 N = two-stage cooling, single circuit, with Humidi-MiZer · pos. 7-8 size: 04/05/06 = 3/4/5 tons, 07-14 = 6-12.5 tons, 17/20/24/28 = 15/17.5/20/25 tons · pos. 10 indoor fan option (2 = standard/medium static) · pos. 14 3 = SystemVu · pos. 15 U = ultra-low-leak temperature economizer with barometric relief. Size 24, option 2: two 22-in. vane-axial fans, 3 bhp maximum per motor (17-28 PD p.11). Static: "External static pressure is the static pressure difference between the return duct and the supply duct plus the static pressure caused by any FIOPs or accessories"; fan tables include clean filters, casing, wet coils and the highest gas heat exchanger: deduct the low / medium heat values and add the Humidi-MiZer and economizer drops.',
  },
  {
    make: 'Carrier, Bryant',
    line: 'WeatherMaker 48TC / 48HC, WeatherExpert 48LC',
    modelPatterns: '48TC*, 48HC*, 48LC*',
    unitType: 'RTU',
    components: RTU_ORDER('Humidi-MiZer reheat coil'),
    confidence: 'stated',
    evidence:
      '48TC-16PD p.25, 48HC-11PD p.30, 48LC-14-26-05PD Rev B p.33: "All units are draw-through in cooling mode and blow-through in heating mode." Reheat: "reheat condenser coil downstream of the evaporator" (48TC-16PD p.55, 48HC-11PD p.84). Filter and reheat positions relative to the fan inferred.',
    documents: [
      { title: '48TC product data', kind: 'productData', ref: '48TC-16PD, 07/11', url: `${ACH}/48TC-16pd.pdf` },
      { title: '48HC product data', kind: 'productData', ref: '48HC-11PD, 09/11', url: `${ACH}/48hc-11pd.pdf` },
      {
        title: '48LC 14-26 product data',
        kind: 'productData',
        ref: '48LC-14-26-05PD Rev B, 12-2020',
        url: `${SHAREDDOCS}/0D/48LC-14-26-05PD.pdf`,
      },
    ],
    notes: 'Fan tables: 48TC include high gas heat; 48HC and 48LC list clean filters, casing and wet coils only.',
  },
  {
    make: 'Carrier',
    line: 'WeatherMaker 48FC / 48FE, 48A, 48N',
    modelPatterns: '48FC*, 48FE*, 48GC*, 48A*, 48N*',
    unitType: 'RTU',
    components: RTU_ORDER('Humidi-MiZer reheat coil'),
    confidence: 'unconfirmed',
    evidence: 'Not read yet; assumed to follow the 48TC / 48GE family (draw-through cooling, blow-through heating).',
    documents: [
      { title: '48/50FC 08-16 product data', kind: 'productData', ref: '48-50FC-8-16-01PD' },
      { title: '48/50FE product data', kind: 'productData', ref: '48-50FE-8-16-01PD' },
      { title: '48/50A product data', kind: 'productData', ref: '48/50A-18PD' },
      { title: '48/50N product data', kind: 'productData', ref: '48-50N-6PD' },
    ],
    notes: '',
  },
  // ---------------------------------------------------------------------------------------------------- York
  {
    make: 'York, Johnson Controls',
    line: 'Sun Premier 25-80 ton',
    modelPatterns: '',
    unitType: 'RTU',
    components: [
      c('damper', 'Economizer / energy recovery wheel / return fan', true),
      c('filter', 'Draw-thru filter'),
      c('coil', 'Evaporator coil'),
      c('reheat', 'Hot gas reheat coil', true),
      c('fan', 'Direct drive plenum (DDP) supply fan'),
      c('heat', 'Gas / electric / hot water / steam heat (discharge plenum)'),
      c('finalFilter', 'Post-evaporator blank (final filter, humidifier, attenuator)', true),
    ],
    confidence: 'stated',
    evidence:
      '5586991-YIM-A p.27 Fig. 9 "Standard Cabinet Unit Sections": Economizer, Draw-Thru Filter, Evaporator, Supply Fan, Heat and Discharge, Condenser Fan cabinets; p.13 Fig. 1 legend: Economizer, Filter section, Evaporator coil, DDP supply fan, Modulating or staged gas heat. 5514889-YTG-A p.204: "The furnace is located in the DA plenum, downstream of the supply fan." 5587001-YSG-A p.49: "The HGRH coil is located after the evaporator coil in the airstream." Post-evaporator blank vs heat section: uncertain.',
    documents: [
      {
        title: 'Sun Premier installation manual',
        kind: 'manual',
        ref: '5586991-YIM-A-520',
        url: `${NAV}/5586991-yim-a.pdf`,
      },
      {
        title: 'Sun Premier technical guide',
        kind: 'productData',
        ref: '5514889-YTG-A',
        url: `${NAV}/5514889-ytg-a.pdf`,
      },
      {
        title: 'Sun Premier start-up and operation guide',
        kind: 'manual',
        ref: '5587001-YSG-A-520',
        url: `${NAV}/5587001-ysg-a.pdf`,
      },
    ],
    notes:
      'Component pressure drops in the technical guide (e.g. Table 145 p.93: HGRH coil 0.39 in. w.g. at 10,000 SCFM on 25-30 ton). Add the Sun Premier model prefix to Model patterns when known.',
  },
  {
    make: 'York, Johnson Controls',
    line: 'YPAL / YRK 50-150 ton',
    modelPatterns: 'YPAL*, YRK*',
    unitType: 'RTU',
    components: [
      c('damper', 'Economizer / mixing box', true),
      c('filter', 'Filter segments'),
      c('coil', 'Cooling coil'),
      c('reheat', 'Hot gas reheat coil', true),
      c('fan', 'Supply fan'),
      c('heat', 'Furnace (discharge plenum)'),
      c('finalFilter', 'Final filter', true),
    ],
    confidence: 'stated',
    evidence:
      'YRK1-EG1 p.17 Fig. 3 legend with AIR FLOW arrow: "EE/OA/MB → Filter Segments → CC Cooling Coils → FS Supply Fan → DP Discharge Plenum → CO Condenser". pp.8, 65-66: "The furnace is located in the discharge plenum, downstream of the supply fan." p.66: "a HGRH coil mounted downstream of evaporator coil." p.67: final filter "downstream of the supply fan and diffuser segment".',
    documents: [
      {
        title: 'YORK 50-65 ton engineering guide',
        kind: 'productData',
        ref: 'YRK1-EG1 (121)',
        url: `${NAV}/yrk1-eg1.pdf`,
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
      'Electric heat stated: "mounted at the discharge of the supply air blower" (5168277-YTG-K p.5; 5998066-YTG-B p.9). Gas heat exchanger after the blower inferred: cutaways (5167795-YTG-O p.2, 5190086-YTG-L p.2) label the heat exchanger and blower without the order; blower tables "include gas heat exchangers and 2" filters".',
    documents: [
      {
        title: 'ZH/ZJ/ZR 3-12.5 ton technical guide',
        kind: 'productData',
        ref: '5167795-YTG-O-0120',
        url: `${NAV}/5167795-ytg-o-0120.pdf`,
      },
      {
        title: 'ZJ/ZR/ZF 15-25 ton technical guide',
        kind: 'productData',
        ref: '5168277-YTG-K-0119',
        url: `${NAV}/5168277-ytg-k-0119.pdf`,
      },
      {
        title: 'ZE/XN 3-6 ton technical guide',
        kind: 'productData',
        ref: '5190086-YTG-L-0623',
        url: `${NAV}/5190086-ytg-l-0623.pdf`,
      },
      {
        title: 'Sun Choice HV13-25 technical guide (heat pump)',
        kind: 'productData',
        ref: '5998066-YTG-B-0123',
        url: `${NAV}/5998066-ytg-b-0123.pdf`,
      },
    ],
    notes:
      'Published external static excludes the furnace and the standard filter (in the blower tables); add the economizer, 4" pleated filter and electric heat from the "Additional Static Resistance" tables (5167795-YTG-O p.97). York dry-coil airflow check: pressure drop across the indoor coil through the two 5/16" dot plugs.',
  },
  // ---------------------------------------------------------------------------------------------------- Lennox
  {
    make: 'Lennox',
    line: 'Energence / Landmark LGH / LCH',
    modelPatterns: 'LGH*, LCH*',
    unitType: 'RTU',
    components: RTU_ORDER(
      'Humiditrol / hot gas reheat coil',
      'Supply blower',
      'Gas heat exchanger / electric heat (under the blower)',
    ),
    confidence: 'stated',
    evidence:
      '0924-L11 (3-6 ton) Figure 1 "LGH parts arrangement": filters → evaporator coil → Humiditrol coil (optional) → blower, burners and heat exchanger under the blower. 1008-L2 (7.5-12.5 ton) Figs 1-3 pp.25-26: filters, evaporator coil, reheat coil (hot gas reheat units only), blower, burners below; p.43: "The supply air blowers… force air across all surfaces of the tubes"; p.65: reheat coil "adjacent to and downstream of the evaporator coil".',
    documents: [
      {
        title: 'LGH/LCH 3-6 ton service literature',
        kind: 'manual',
        ref: '0924-L11 (Fig. 1 parts arrangement, Fig. 9 static readings)',
        url: `${LENNOX}/08178a7baa/0924e.pdf`,
      },
      {
        title: 'LGH 7.5-12.5 ton service literature',
        kind: 'manual',
        ref: '1008-L2, rev. 05/2020 (Fig. 19 static readings)',
        url: `${LENNOX}/efd0657429/1069939~1008f.pdf`,
      },
    ],
    notes: LENNOX_STATIC,
  },
  {
    make: 'Lennox',
    line: 'Raider ZGA / ZGB',
    modelPatterns: 'ZGA*, ZGB*, ZGC*, ZGD*, ZCA*, ZCB*',
    unitType: 'RTU',
    components: RTU_ORDER('Reheat coil', 'Belt-drive supply blower', 'Gas heat exchanger (under the blower)'),
    confidence: 'stated',
    evidence:
      '1401-L4 p.18 Fig. 1 "ZGA/ZGB parts arrangement": filters (behind coil), evaporator coil, blower housing, heat exchanger directly below the blower; p.20: "belt-drive blowers which draw air across the evaporator"; p.25: "The supply air blower forces air across the tubes to extract the heat of combustion." Reheat and economizer not shown.',
    documents: [
      {
        title: 'ZGA/ZGB service literature',
        kind: 'manual',
        ref: '1401-L4, rev. 05/2020 (Fig. 6 static readings)',
        url: `${LENNOX}/3e68d70bff/1401b.pdf`,
      },
    ],
    notes: LENNOX_STATIC,
  },
  {
    make: 'Lennox',
    line: 'Model L LGM / LCM',
    modelPatterns: 'LGM*, LCM*',
    unitType: 'RTU',
    components: RTU_ORDER('Reheat coil', 'Direct-drive supply blower', 'Gas heat exchanger (under the blower)'),
    confidence: 'stated',
    evidence:
      '100036 p.12 Fig. 1 "Parts arrangement - 092U, 102U, 120U, 150U": economizer (optional), filters, evaporator, reheat coil (optional), blower, burners below; p.32: "The supply air blowers… force air across all surfaces of the tubes to extract the heat of combustion."; p.47: reheat coil "adjacent to and downstream of the evaporator coil".',
    documents: [
      {
        title: 'LGM service literature',
        kind: 'manual',
        ref: '100036 (Fig. 13 static readings)',
        url: `${LENNOX}/7badeab555/100036.pdf`,
      },
    ],
    notes: LENNOX_STATIC,
  },
  {
    make: 'Lennox',
    line: 'Xion LGX / LCX',
    modelPatterns: 'LGX*, LCX*',
    unitType: 'RTU',
    components: RTU_ORDER('Reheat coil', 'Supply blower', 'Gas burners / electric heat (under the blower)'),
    confidence: 'inferred',
    evidence:
      '508513-01 p.5 "LGX / LCX parts arrangement": economizer, filters, evaporator coil, reheat coil, blower, with burners (LGX) or electric heat (LCX) below the blower; p.44: reheat coil "adjacent to and downstream of the evaporator coil". No "blower forces air" sentence in this document: heat after the blower inferred from the arrangement and the other Lennox lines.',
    documents: [
      {
        title: 'LGX/LCX 7.5-12.5 ton installation instructions (R-454B)',
        kind: 'manual',
        ref: '508513-01, 2/2025 (Fig. 25 static readings)',
        url: `${LENNOX}/11914fe192/508513-01.pdf`,
      },
    ],
    notes: LENNOX_STATIC,
  },
  {
    make: 'Lennox',
    line: 'Strategos, Enlight',
    modelPatterns: 'KGA*, KGB*, KCB*, LGT*, LCT*, LHT*',
    unitType: 'RTU',
    components: RTU_ORDER('Humiditrol reheat coil'),
    confidence: 'unconfirmed',
    evidence: 'Not read yet; assumed to follow the other Lennox lines (blower forces air across the heat exchanger).',
    documents: [
      { title: 'KGB/KCB installation manual', kind: 'manual', ref: '507348-09a' },
      { title: 'KGA/KGB service literature', kind: 'manual', ref: '0801-L1' },
    ],
    notes: '',
  },
  // ---------------------------------------------------------------------------------------------------- Trane
  {
    make: 'Trane, American Standard',
    line: 'Precedent',
    modelPatterns: 'YSC*, YHC*, TSC*, THC*',
    unitType: 'RTU',
    components: RTU_ORDER('Hot gas reheat coil', 'Indoor fan', 'Gas furnace / electric heat'),
    confidence: 'inferred',
    evidence:
      'RT-SVX21AD-EN (06/2022) Fig. 42 cutaway: slanted evaporator coil → indoor fan housing, gas furnace box directly under the fan discharge; TCO1 "is located behind the indoor fan access panel mounted on the top of the heat exchanger wrapper." Heat after the fan shown by the drawing, not stated in words.',
    documents: [
      { title: 'Precedent 3-10 ton gas/electric IOM', kind: 'manual', ref: 'RT-SVX21AD-EN, 06/2022 (Fig. 42)' },
      {
        title: 'Precedent electric heat product catalog',
        kind: 'productData',
        ref: 'RT-PRC096F-EN, 02/2024',
        url: `${TRANE}/Product%20Catalog/RT-PRC096F-EN_02292024.pdf`,
      },
    ],
    notes:
      'Trane: "Measure the supply and return duct static pressure and sum the resulting absolute values", add the accessory drops (curb, economizer …) from the Service Facts, then read the fan tables (which include standard filters and wet coils) with the RPM / speed tap or the motor amps.',
  },
  {
    make: 'Trane',
    line: 'Voyager (12.5-25 ton) and Voyager 3 (27.5-50 ton)',
    modelPatterns: 'YCD*, YCH*, YHH*, TCD*, TCH*',
    unitType: 'RTU',
    components: RTU_ORDER('Hot gas reheat coil', 'Supply fan', 'Gas / electric heat module'),
    confidence: 'inferred',
    evidence:
      'Voyager 3 RT-PRC033Q-EN p.107: "A reheat condenser coil shall be factory installed downstream of the unit evaporator coil" (Fig. 1 p.9: Evaporator Coil, then Reheat Coil). RT-SVX089E-EN p.29: condensate drain "on the \'negative pressure\' side of the fan". Heat after the fan inferred: RT-PRC033Q p.22 adds the supply fan motor heat before the heat module ("Mixed air temperature entering heat module = 64.8 + 1.9").',
    documents: [
      {
        title: 'Voyager 3 product catalog',
        kind: 'productData',
        ref: 'RT-PRC033Q-EN, 03/2023',
        url: `${TRANE}/Product%20Catalog/RT-PRC033Q-EN_03112023.pdf`,
      },
      {
        title: 'Voyager 3 IOM (R-454B)',
        kind: 'manual',
        ref: 'RT-SVX089E-EN, 04/2026',
        url: `${TRANE}/Installation%20Operation%20and%20Maintenance/RT-SVX089E-EN_04172026.pdf`,
      },
      {
        title: 'Voyager 3 IOM (R-410A)',
        kind: 'manual',
        ref: 'RT-SVX34W-EN, 03/2023',
        url: `${TRANE}/Installation%20Operation%20and%20Maintenance/RT-SVX34W-EN_03112023.pdf`,
      },
      { title: 'Voyager 12.5-25 ton IOM', kind: 'manual', ref: 'RT-SVX48E-EN' },
    ],
    notes:
      'RT-PRC033Q Table 23 p.50: component drops (gas heat low/high, electric heat, dry/wet coil, filters, economizer, reheat coil) "must be added to external static pressure to enter fan selection tables". Add the Voyager 3 model prefixes to Model patterns when known.',
  },
  {
    make: 'Trane',
    line: 'IntelliPak',
    modelPatterns: 'S?HL*',
    unitType: 'RTU',
    components: [
      c('damper', 'Exhaust / return fan, economizer', true),
      c('filter', 'Pre-evaporator filters'),
      c('coil', 'Evaporator coil'),
      c('fan', 'Supply fan'),
      c('heat', 'Heater', true),
      c('finalFilter', 'Final filters', true),
    ],
    confidence: 'stated',
    evidence:
      'RT-SVX072E-EN (10/2024) p.26 Fig. 10, labelled plan from the outside / return air end: F "Filter Access", H "Supply Fan Access", G "optional Heater or Final Filter Access", C "Supply Air Opening"; p.33: condensate drain "on the \'negative pressure\' side of the fan". Filter monitor option "Pre-Evaporator and Final Filter".',
    documents: [
      {
        title: 'IntelliPak 1 with Symbio 800 IOM',
        kind: 'manual',
        ref: 'RT-SVX072E-EN, 10/2024 (Fig. 10)',
        url: `${TRANE}/Installation%20Operation%20and%20Maintenance/RT-SVX072E-EN_10122024.pdf`,
      },
    ],
    notes:
      'Component pressure-drop table notes (p.97): add accessory drops to the external static; gas heat 60°F maximum rise.',
  },
  {
    make: 'Trane',
    line: 'Foundation 15-25 ton',
    modelPatterns: 'GBC*, GBH*, GDK*',
    unitType: 'RTU',
    components: RTU_ORDER('Hot gas reheat coil'),
    confidence: 'inferred',
    evidence:
      'RT-PRC125A-EN p.9: "The evaporator is a draw-through configuration." Heat position not shown (exterior drawings only); assumed after the fan like the other Trane lines.',
    documents: [
      {
        title: 'Foundation product catalog',
        kind: 'productData',
        ref: 'RT-PRC125A-EN, 09/2024',
        url: `${TRANE}/Product%20Catalog/RT-PRC125A-EN_09152024.pdf`,
      },
      {
        title: 'Foundation IOM',
        kind: 'manual',
        ref: 'RT-SVX095C-EN, 08/2025',
        url: `${TRANE}/Installation%20Operation%20and%20Maintenance/RT-SVX095C-EN_08182025.pdf`,
      },
    ],
    notes: '',
  },
  // ---------------------------------------------------------------------------------------------------- Addison
  {
    make: 'Addison',
    line: 'PR / PRAK DOAS',
    modelPatterns: 'PR*, AK*',
    unitType: 'DOAS',
    components: [
      c('filter', 'OA / RA wheel filters (2")', true),
      c('wheel', 'Energy recovery wheel', true),
      c('filter', 'Filters'),
      c('coil', 'Evaporator coil'),
      c('reheat', 'Subcooling coil, then hot gas reheat coil', true),
      c('fan', 'Direct drive plenum supply blower'),
      c('heat', 'Duct furnace / electric heater'),
    ],
    confidence: 'inferred',
    evidence:
      'Stated: PR IOM R-454B p.45 Fig. 9 note 8 (AIR FLOW arrow): "SUB-COOLING COIL IS TO BE INSTALLED DOWNSTREAM OF EVAP. REHEAT COIL DOWNSTREAM OF SUB-COOLING COIL" (AK IOM p.23 Fig. 7 the same); p.75: "Install ECA-T/RH after the ECW" (wheel before the coil); "SENSOR MUST BE INSTALLED DOWNSTREAM OF HEATER". Not shown in any Addison document: the supply blower position and the heater relative to the blower (order after the reheat coil inferred). Use the unit submittal.',
    documents: [
      {
        title: 'PR Series IOM, R-454B',
        kind: 'manual',
        ref: 'rev. 12 Sept 2025',
        url: `${ADDISON}/2025/10/PR-IOM-R454B.pdf`,
      },
      { title: 'PR Series IOM', kind: 'manual', ref: 'rev. 19 Jun 2020', url: `${ADDISON}/2025/07/Addison-PR-IOM.pdf` },
      { title: 'PRAK Series IOM', kind: 'manual', ref: '18 Nov 2020', url: `${ADDISON}/2021/01/Addison-AK-IOM.pdf` },
      {
        title: 'PR start-up form',
        kind: 'other',
        ref: 'rev. 19 June 2020',
        url: `${ADDISON}/2021/01/PR-Start-Up-Form.pdf`,
      },
      { title: 'PR brochure', kind: 'productData', ref: 'PR2023', url: `${ADDISON}/2024/08/Addison_PR_Handout.pdf` },
    ],
    notes:
      'Start-up form: supply fan CFM and ESP1 "taken from field supply ductwork", exhaust fan CFM and ESP2 "taken from field return ductwork", against the Design Duct ESP. Clean the wheel when its measured pressure drop "exceeds the design pressure drop by 10%" (R-454B IOM p.56).',
  },
  // ---------------------------------------------------------------------------------------------------- Munters
  {
    make: 'Munters',
    line: 'DryCool HCUc / Standard (desiccant)',
    modelPatterns: 'HCUC*, HCU*',
    unitType: 'DHU',
    components: [
      c('damper', 'Makeup / return air dampers', true),
      c('filter'),
      c('coil', 'DX evaporator coil'),
      c('desiccant', 'Desiccant wheel, process side (bypass damper alongside)'),
      c('fan', 'Supply fan'),
      c('heat', 'Post-heat (gas, electric, hot water)', true),
    ],
    confidence: 'stated',
    evidence:
      'Engineering catalog EC0004-10 (11/08) p.2 Operating Principles cutaway: Makeup Inlet, Evaporator Coil, Bypass Damper, Desiccant Wheel, Supply Fan, Post Heat; "The warm, moist outside air first passes through filters and then the direct expansion (DX) cooling coil… The air passes through the desiccant wheel". p.35 drawing "HCUc 8000" (S71074-022 rev 01) plan view: FILTERS / DX COIL → DH WHEEL → SUPPLY FAN → HEATER (optional gas, electric or hot water) → SUPPLY OUTLET.',
    documents: [
      {
        title: 'DryCool Standard System engineering catalog',
        kind: 'productData',
        ref: 'EC0004-10, 11/08 (p.2 cutaway, p.35 HCUc 8000 drawing, p.7 model key)',
        url: `${MUNTERS}/Engineering%20Catalog-%20DryCool%20Standard%20System.pdf`,
      },
      { title: 'DryCool Standard product sheet', kind: 'productData', ref: 'PS-EN-202001' },
      {
        title: 'DryCool HCUi product guide',
        kind: 'productData',
        ref: 'PG0068-01, 06/18',
        url: `${MUNTERS}/Product%20Guide-%20DryCool%20HCUi.pdf`,
      },
    ],
    notes:
      'Model key (catalog p.7): HCU · c = 3rd generation · 80 = HCU-8000 (4,000-8,000 cfm; product sheet: 8,000 cfm nominal, 40 compressor tons) · 40 = nominal tons · position 4 A = DX air-cooled packaged outdoor · position 5 = refrigerant (A = R-410A) · then voltage, inlet (A makeup, C return, D-F with dampers), discharge side, post-heat type / size / stages, filters (S = 2" pleated 30%). Reactivation: inlet → condensing / reactivation coil → filters → wheel → react fan → outlet. In dehumidification the wheel bypass damper opens and the supply fan slows. No static pressure guidance in the catalogs.',
  },
  {
    make: 'Munters',
    line: 'DryCool ERV',
    modelPatterns: 'DC-ERV*',
    unitType: 'DHU',
    components: [
      c('filter'),
      c('wheel', 'Enthalpy (energy recovery) wheel'),
      c('damper', 'Dampers', true),
      c('filter', 'Filters'),
      c('coil', 'DX coil'),
      c('desiccant', 'Desiccant wheel'),
      c('fan', 'Supply fan'),
      c('heat', 'Post heat', true),
    ],
    confidence: 'stated',
    evidence:
      'Engineering catalog EG0011-03 (08/09) p.2 cutaway and p.26 drawing DC-ERV-4714-5416-6018 (S71096-002): MAKEUP INLET → FILTERS / ERV WHEEL → DAMPERS → FILTERS / DX COIL → DH WHEEL → SUPPLY FAN → HEATER → SUPPLY OUTLET.',
    documents: [
      {
        title: 'DryCool ERV engineering catalog',
        kind: 'productData',
        ref: 'EG0011-03, 08/09',
        url: `${MUNTERS}/Engineering%20Catalog-%20DryCool%20ERV.pdf`,
      },
    ],
    notes: '',
  },
  {
    make: 'Munters',
    line: 'DryCool Dehumidification System (DDS, modular)',
    modelPatterns: 'DDS*',
    unitType: 'DHU',
    components: [
      c('filter'),
      c('wheel', 'Enthalpy wheel (module C)', true),
      c('desiccant', 'Dehumidifier module: desiccant wheel with bypass (module B)'),
      c('coil', 'Cooling coil (module D)'),
      c('fan', 'Supply fan (module H)'),
      c('heat', 'Indirect-fired post heater (module I)', true),
    ],
    confidence: 'stated',
    evidence:
      'Engineering catalog EC0001-03 (02/09) p.13 (DDS-30-3 example): "The following components are shown in sequential order from air entering to air leaving. Module C… B… D… H – Supply fan, I – Indirect fired post heater." Modular: configurations differ (p.8); for systems without bypass the fan is in the dehumidifier module. Check the job drawing.',
    documents: [
      {
        title: 'DryCool Dehumidification System engineering catalog',
        kind: 'productData',
        ref: 'EC0001-03, 02/09',
        url: `${MUNTERS}/Engineering%20Catalog-%20DDS.pdf`,
      },
    ],
    notes: '',
  },
  {
    make: 'Munters',
    line: 'ISA industrial desiccant dehumidifier',
    modelPatterns: 'ISA*',
    unitType: 'DHU',
    components: [
      c('coil', 'Pre-rotor heating / cooling coil', true),
      c('desiccant', 'HPS desiccant rotor'),
      c('coil', 'Post-rotor heating / cooling coil', true),
      c('fan', 'Process fan (VFD)'),
    ],
    confidence: 'unconfirmed',
    evidence:
      'Product sheet ISA-PS-EN-202505: "Combined heating and cooling coils pre- and post-rotor"; configurable fans with VFDs; 5,000-32,000 SCFM. Fan and filter positions not shown.',
    documents: [{ title: 'Munters ISA product sheet', kind: 'productData', ref: 'ISA-PS-EN-202505' }],
    notes: 'Industrial low dew point (40°F to -40°F) unit; gas, steam or electric reactivation.',
  },
  // ---------------------------------------------------------------------------------------------------- CaptiveAire
  {
    make: 'CaptiveAire, Captive-Aire',
    line: 'Direct-fired make-up air, A-series (A1-A5 D)',
    modelPatterns: 'A?-D*',
    unitType: 'MAU',
    components: [
      c('filter', 'Intake hood with 2" filters and screen'),
      c('burner', 'Direct-fired burner (profile plates)'),
      c('fan', 'Blower'),
    ],
    confidence: 'stated',
    evidence:
      'AD Modular Direct Fired Heaters spec sheet: "The burner module … is located upstream of the blower module", with an "outside air inlet hood with standard 2" filters and screen". Direct Fired Heaters OIM A0011030 (Rev. 37, 06/2021) p.10 Fig. 7 "Heat Module": Blower, Direct Fired Module, Intake Housing, Filters, airflow toward the blower; "Attach heat module to blower intake." p.8 Fig. 3: Intake Housing → Direct Fired Module → Blower → Discharge Opening.',
    documents: [
      {
        title: 'Standard and modular direct fired heaters OIM',
        kind: 'manual',
        ref: 'A0011030 Rev. 37, June 2021',
        url: `${CAPTIVE}/manuals/makeupair/direct-heater-oim.pdf`,
      },
      {
        title: 'MUA controls, direct fired heaters OIM',
        kind: 'manual',
        ref: 'Rev. 25, Aug 2026',
        url: `${CAPTIVE}/manuals/makeupair/direct-fired-mua-oim.pdf`,
      },
      { title: 'AD modular direct fired heaters specification', kind: 'productData' },
    ],
    notes:
      'Model: A1-A5 = heater / housing size; .250-.2500 = burner size (thousands of BTUH, inferred); 15D / 20D / 20Z / 22Z / G15 = fan (published A2 models pair with 20D, 20Z, 22Z or G15; 15D only on A1: check an "A2-D.250-15D" nameplate). Airflow: measure the burner profile pressure drop at the airflow tubes (positive reading; reverse the tubes if negative), 0.15-0.80 in. w.c., and read CFM off the profile chart (OIM Figs 27-28; MUA controls OIM Figs 35-36); outside the range, adjust the blower RPM. Maximum SP 3 in. w.g.',
  },
  {
    make: 'CaptiveAire, Captive-Aire',
    line: 'D76 compact direct-fired heater',
    modelPatterns: 'D76*',
    unitType: 'MAU',
    components: [
      c('filter', 'Screened intake with filter'),
      c('burner', 'Direct-fired burner'),
      c('fan', 'Blower (in the D76 package)'),
    ],
    confidence: 'inferred',
    evidence:
      'MUA Controls Compact Direct Fired Heaters OIM (Rev. 20, 06/2026) p.7 Fig. 3: Screened Intake and Filter Access Door at the inlet, gas pipe in the middle section, Blower/Motor Access Door and Discharge Opening, airflow toward the discharge. The blower is part of the package; the burner is not labelled (its position before the blower inferred from the gas connection).',
    documents: [
      {
        title: 'MUA controls, compact direct fired heaters OIM',
        kind: 'manual',
        ref: 'Rev. 20, June 2026 (Fig. 3; Fig. 27 "76 profile chart")',
        url: `${CAPTIVE}/Manuals/MakeUpAir/Compact%20MUA%20OIM.pdf`,
      },
    ],
    notes:
      'Airflow from the burner profile pressure drop and the "76 Profile Chart" (Fig. 27); proper range 0.15-0.80 in. w.c.',
  },
  // ---------------------------------------------------------------------------------------------------- Seasons-4
  {
    make: 'Seasons-4, Seasons 4',
    line: 'Classic Series 10-35 ton',
    modelPatterns: '',
    unitType: 'RTU',
    components: [
      c('damper', 'Return air section', true),
      c('filter'),
      c('coil', 'DX coil'),
      c('reheat', 'Heat reclaim (HR) coil', true),
      c('fan', 'Supply air blower'),
      c('heat', 'Heat section and supply plenum'),
    ],
    confidence: 'stated',
    evidence:
      'Classic Series brochure (Jan 2008) cover cutaway labels: R.A. SECTION → FILTERS → DX COIL → HR COIL → S.A. BLOWER → HEAT SECTION & S.A. PLENUM.',
    documents: [
      {
        title: 'Classic Series brochure',
        kind: 'productData',
        ref: 'Jan 2008',
        url: `${S4}/2012/06/Classic-Series-Brochure-Jan-2008-all-021.pdf`,
      },
    ],
    notes: 'Oversized blower motor option "for ESP up to 2.0"". Custom units: confirm each job against its submittal.',
  },
  {
    make: 'Seasons-4, Seasons 4',
    line: 'Dual Path supermarket units, custom DOAS / DHU',
    modelPatterns: '',
    unitType: 'DOAS',
    components: [
      c('coil', 'Outdoor air precool coil'),
      c('coil', 'Dehumidifier coil (outdoor air path)'),
      c('reheat', 'Heat reclaim coils', true),
      c('fan', 'Supply blower'),
      c('heat', 'Auxiliary heat', true),
    ],
    confidence: 'inferred',
    evidence:
      'Dual Path brochure (08/2026) p.5 labelled diagram: outdoor air → PRECOOL COIL → DEHUMIDIFIER COIL (upper deck); store air → RETURN AIR COIL (lower deck); both → HEAT RECLAIM COILS. Blower and heat positions inferred from the unlabelled cutaway (2004 brochure: burner beside the blower outlet). Desiccant DHU (C758-01 spec sheet): order not shown; supply total static 3.30 in., external 1.50 in., wheel process drop 1.02 in.',
    documents: [
      {
        title: 'Dual Path brochure',
        kind: 'productData',
        ref: '08/2026',
        url: `${S4}/2026/08/Seasons-4-Dual-Path-Brochure-08-20-2026.pdf`,
      },
      {
        title: 'Energy recovery systems brochure',
        kind: 'productData',
        ref: '11/2012',
        url: `${S4}/2012/07/ERU-SYSTEMS.pdf`,
      },
      {
        title: 'Desiccant unit "Now in production" sheet',
        kind: 'productData',
        ref: '03/2018',
        url: `${S4}/2018/03/NIP-John-Rhodes-Arena-March-2018.pdf`,
      },
    ],
    notes: 'Custom units: the job submittal is the source of truth. Factory: 770-489-0716.',
  },
];
