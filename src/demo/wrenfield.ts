/**
 * Wrenfield Home Cleaning — the fictional demo business (Raleigh, NC).
 *
 * Every person, phone number and street here is invented. Phone numbers use the 555-01xx range reserved
 * for fiction; e-mail addresses use the reserved .example domain. ZIP codes are real Wake County ZIPs so
 * service zones look plausible.
 *
 * The rule objects are tenant data: they are written to rule_versions and the owner edits them in the
 * admin console. The domain layer validates and interprets them.
 */

import type {
  CancellationRules,
  PricingRules,
  ScheduleRules,
} from "@/domain/rules";

export const wrenfieldTenant = {
  slug: "wrenfield",
  name: "Wrenfield Home Cleaning",
  timezone: "America/New_York",
  contactEmail: "hello@wrenfield.example",
  phone: "(919) 555-0100",
} as const;

export const wrenfieldCrews = [
  { key: "blue", name: "Crew Blue", color: "#2563eb" },
  { key: "green", name: "Crew Green", color: "#16a34a" },
  { key: "amber", name: "Crew Amber", color: "#d97706" },
] as const;

type CrewKey = (typeof wrenfieldCrews)[number]["key"];

type StaffMember = {
  key: string;
  fullName: string;
  email: string;
  role: "owner" | "dispatcher" | "cleaner";
  crew?: CrewKey;
};

export const wrenfieldStaff: StaffMember[] = [
  {
    key: "owner",
    fullName: "Lauren Mercer",
    email: "owner@wrenfield.example",
    role: "owner",
  },
  {
    key: "dispatcher",
    fullName: "Marcus Hill",
    email: "dispatch@wrenfield.example",
    role: "dispatcher",
  },
  {
    key: "ana",
    fullName: "Ana Ramirez",
    email: "ana@wrenfield.example",
    role: "cleaner",
    crew: "blue",
  },
  {
    key: "jasmine",
    fullName: "Jasmine Carter",
    email: "jasmine@wrenfield.example",
    role: "cleaner",
    crew: "blue",
  },
  {
    key: "tyler",
    fullName: "Tyler Brooks",
    email: "tyler@wrenfield.example",
    role: "cleaner",
    crew: "green",
  },
  {
    key: "mei",
    fullName: "Mei Lin",
    email: "mei@wrenfield.example",
    role: "cleaner",
    crew: "green",
  },
  {
    key: "rosa",
    fullName: "Rosa Delgado",
    email: "rosa@wrenfield.example",
    role: "cleaner",
    crew: "amber",
  },
  {
    key: "kendra",
    fullName: "Kendra Ellis",
    email: "kendra@wrenfield.example",
    role: "cleaner",
    crew: "amber",
  },
];

export const wrenfieldServices = [
  {
    code: "standard",
    name: "Standard Clean",
    description:
      "Kitchen, bathrooms, dusting, floors and surfaces throughout the home.",
    bookingMode: "instant",
  },
  {
    code: "deep",
    name: "Deep Clean",
    description:
      "Everything in a standard clean plus baseboards, doors, vents and built-up grime.",
    bookingMode: "instant",
  },
  {
    code: "move_in_out",
    name: "Move-In / Move-Out Clean",
    description:
      "A deep clean of an empty home, inside cabinets and appliances included.",
    bookingMode: "instant",
  },
  {
    code: "post_renovation",
    name: "Post-Renovation Clean",
    description:
      "Dust and debris removal after remodeling. Quoted after we see photos.",
    bookingMode: "quote_request",
  },
  {
    code: "office",
    name: "Small Office Clean",
    description:
      "Offices up to 3,000 sq ft. Quoted after a short walkthrough or photos.",
    bookingMode: "quote_request",
  },
] as const;

export const wrenfieldPricingRules: PricingRules = {
  services: {
    standard: { base_cents: 12000, base_minutes: 120, recurring: true },
    deep: { base_cents: 26000, base_minutes: 240 },
    move_in_out: {
      base_cents: 31000,
      base_minutes: 270,
      empty_home_only: true,
    },
  },
  // The base price covers a 1-bedroom, 1-bath home up to 1,500 sq ft.
  included: { bedrooms: 1, full_baths: 1, half_baths: 0, sqft: 1500 },
  home_size: {
    bedroom: { cents: 2500, minutes: 20 },
    full_bath: { cents: 3000, minutes: 25 },
    half_bath: { cents: 1500, minutes: 10 },
    sqft_step: { size: 500, cents: 2000, minutes: 15 },
  },
  addons: {
    fridge: { name: "Inside fridge", cents: 3500, minutes: 30 },
    oven: { name: "Inside oven", cents: 3500, minutes: 30 },
    cabinets: { name: "Inside cabinets", cents: 4000, minutes: 30 },
    windows_inside: {
      name: "Interior windows",
      cents: 600,
      minutes: 5,
      per_unit: true,
      max_units: 40,
    },
    laundry: {
      name: "Laundry (per load)",
      cents: 2500,
      minutes: 15,
      per_unit: true,
      max_units: 4,
    },
    pet_hair: { name: "Pet hair treatment", cents: 1500, minutes: 15 },
  },
  condition: { heavy: { percent: 20, needs_review: true } },
  frequency_discount_percent: {
    one_time: 0,
    weekly: 15,
    biweekly: 10,
    monthly: 5,
  },
  first_visit: { upgrade_to: "deep", if_no_professional_clean_days: 60 },
  minimum_cents: 15000,
  zones: [
    {
      code: "A",
      name: "Central Raleigh",
      surcharge_cents: 0,
      zips: [
        "27601",
        "27603",
        "27604",
        "27605",
        "27607",
        "27608",
        "27609",
        "27610",
        "27612",
      ],
    },
    {
      code: "B",
      name: "North Raleigh & Cary",
      surcharge_cents: 1500,
      zips: [
        "27511",
        "27513",
        "27518",
        "27606",
        "27613",
        "27614",
        "27615",
        "27616",
        "27617",
      ],
    },
    {
      code: "C",
      name: "Outer Wake County",
      surcharge_cents: 3000,
      zips: [
        "27519",
        "27523",
        "27526",
        "27529",
        "27539",
        "27560",
        "27587",
        "27597",
      ],
    },
  ],
  deposit: { percent: 25, minimum_cents: 5000 },
};

export const wrenfieldScheduleRules: ScheduleRules = {
  business_hours: {
    mon: ["08:00", "18:00"],
    tue: ["08:00", "18:00"],
    wed: ["08:00", "18:00"],
    thu: ["08:00", "18:00"],
    fri: ["08:00", "18:00"],
    sat: ["08:00", "18:00"],
    sun: null,
  },
  arrival_windows: [
    ["08:00", "09:00"],
    ["11:00", "12:00"],
    ["14:00", "15:00"],
  ],
  travel_buffer_minutes: 30,
  // Orders placed before 15:00 can book from the next day; later orders from the day after.
  next_day_cutoff: "15:00",
  horizon_days: 60,
  hold_minutes: 10,
  payment_window_minutes: 30,
  closed_dates: ["2026-11-26", "2026-12-24", "2026-12-25", "2027-01-01"],
};

export const wrenfieldCancellationRules: CancellationRules = {
  free_before_hours: 48,
  flat_fee_cents: 4000,
  late_within_hours: 24,
  late_fee_percent: 50,
  no_access_fee_percent: 50,
};

type DemoClient = {
  fullName: string;
  email: string;
  phone: string;
  /** Clients with a key get a portal login for the "Log in as client" demo button. */
  loginKey?: string;
  home: {
    addressLine1: string;
    city: string;
    zip: string;
    bedrooms: number;
    fullBaths: number;
    halfBaths: number;
    sqft: number;
    hasPets: boolean;
    petNotes?: string;
    accessNotes?: string;
    parkingNotes?: string;
  };
};

export const wrenfieldClients: DemoClient[] = [
  {
    fullName: "Emily Thornton",
    email: "emily.thornton@mail.example",
    phone: "(919) 555-0112",
    loginKey: "client",
    home: {
      addressLine1: "1214 Larkmoor Dr",
      city: "Raleigh",
      zip: "27609",
      bedrooms: 3,
      fullBaths: 2,
      halfBaths: 1,
      sqft: 2100,
      hasPets: true,
      petNotes:
        "Friendly golden retriever, Biscuit. Please keep the back gate closed.",
      accessNotes: "Lockbox on the side door, code 4821.",
    },
  },
  {
    fullName: "David Okafor",
    email: "d.okafor@mail.example",
    phone: "(919) 555-0123",
    home: {
      addressLine1: "88 Bellhaven Ct",
      city: "Cary",
      zip: "27513",
      bedrooms: 4,
      fullBaths: 3,
      halfBaths: 0,
      sqft: 2850,
      hasPets: false,
      accessNotes: "Garage keypad 7310. Alarm is off on cleaning days.",
    },
  },
  {
    fullName: "Priya Raman",
    email: "priya.raman@mail.example",
    phone: "(919) 555-0131",
    home: {
      addressLine1: "402 Copperleaf Way",
      city: "Raleigh",
      zip: "27615",
      bedrooms: 2,
      fullBaths: 2,
      halfBaths: 0,
      sqft: 1400,
      hasPets: true,
      petNotes: "Two indoor cats; they hide, no need to look for them.",
      accessNotes: "Someone is home on weekday mornings.",
    },
  },
  {
    fullName: "Michael Brennan",
    email: "mbrennan@mail.example",
    phone: "(919) 555-0144",
    home: {
      addressLine1: "15 Thistledown Ln",
      city: "Raleigh",
      zip: "27605",
      bedrooms: 1,
      fullBaths: 1,
      halfBaths: 0,
      sqft: 780,
      hasPets: false,
      accessNotes: "Apartment 3B. Concierge has a key.",
      parkingNotes: "Visitor spots on level 1 of the garage.",
    },
  },
  {
    fullName: "Sarah Whitaker",
    email: "sarah.whitaker@mail.example",
    phone: "(919) 555-0156",
    home: {
      addressLine1: "2330 Ashcombe Rd",
      city: "Apex",
      zip: "27523",
      bedrooms: 5,
      fullBaths: 3,
      halfBaths: 1,
      sqft: 3600,
      hasPets: true,
      petNotes: "Labrador and a parrot in the den.",
      accessNotes: "Front door code 1957.",
    },
  },
  {
    fullName: "James Holloway",
    email: "jholloway@mail.example",
    phone: "(919) 555-0167",
    home: {
      addressLine1: "617 Willowmere Dr",
      city: "Raleigh",
      zip: "27612",
      bedrooms: 3,
      fullBaths: 2,
      halfBaths: 0,
      sqft: 1750,
      hasPets: false,
      accessNotes: "Key in the lockbox by the mailbox, code 2204.",
    },
  },
  {
    fullName: "Grace Nakamura",
    email: "grace.nakamura@mail.example",
    phone: "(919) 555-0178",
    home: {
      addressLine1: "940 Quillfeather Ct",
      city: "Cary",
      zip: "27519",
      bedrooms: 4,
      fullBaths: 2,
      halfBaths: 1,
      sqft: 2400,
      hasPets: false,
      accessNotes: "Side door keypad 6630.",
    },
  },
  {
    fullName: "Robert Chen",
    email: "rchen@mail.example",
    phone: "(919) 555-0189",
    home: {
      addressLine1: "73 Hollins Ridge Ave",
      city: "Raleigh",
      zip: "27607",
      bedrooms: 2,
      fullBaths: 1,
      halfBaths: 1,
      sqft: 1150,
      hasPets: true,
      petNotes: "Small dog in a crate during the visit.",
      accessNotes: "Hidden key under the planter on the porch.",
    },
  },
  {
    fullName: "Olivia Marsh",
    email: "olivia.marsh@mail.example",
    phone: "(919) 555-0190",
    home: {
      addressLine1: "1801 Fernbrook Pl",
      city: "Wake Forest",
      zip: "27587",
      bedrooms: 4,
      fullBaths: 3,
      halfBaths: 0,
      sqft: 3100,
      hasPets: false,
      accessNotes: "Garage code 8842.",
      parkingNotes: "Park in the driveway, not on the lawn.",
    },
  },
  {
    fullName: "Daniel Fuentes",
    email: "dfuentes@mail.example",
    phone: "(919) 555-0103",
    home: {
      addressLine1: "512 Kestwood Ln",
      city: "Raleigh",
      zip: "27610",
      bedrooms: 3,
      fullBaths: 1,
      halfBaths: 1,
      sqft: 1500,
      hasPets: true,
      petNotes: "Cat; litter box in the laundry room does not need cleaning.",
      accessNotes: "Client works from home; ring the bell.",
    },
  },
  {
    fullName: "Hannah Lindqvist",
    email: "hannah.l@mail.example",
    phone: "(919) 555-0114",
    home: {
      addressLine1: "26 Marlowe Glen",
      city: "Raleigh",
      zip: "27614",
      bedrooms: 3,
      fullBaths: 2,
      halfBaths: 1,
      sqft: 2250,
      hasPets: false,
      accessNotes: "Lockbox on the back porch, code 3391.",
    },
  },
  {
    fullName: "Marcus Bellamy",
    email: "mbellamy@mail.example",
    phone: "(919) 555-0125",
    home: {
      addressLine1: "3307 Saddlebrook Dr",
      city: "Garner",
      zip: "27529",
      bedrooms: 3,
      fullBaths: 2,
      halfBaths: 0,
      sqft: 1650,
      hasPets: true,
      petNotes: "Two dogs, both friendly.",
      accessNotes: "Front door code 5512.",
    },
  },
  {
    fullName: "Natalie Ortiz",
    email: "natalie.ortiz@mail.example",
    phone: "(919) 555-0136",
    home: {
      addressLine1: "44 Cobblecreek Way",
      city: "Raleigh",
      zip: "27608",
      bedrooms: 2,
      fullBaths: 2,
      halfBaths: 0,
      sqft: 1300,
      hasPets: false,
      accessNotes: "Condo unit 210; building code #1144.",
    },
  },
  {
    fullName: "Thomas Reid",
    email: "thomas.reid@mail.example",
    phone: "(919) 555-0147",
    home: {
      addressLine1: "1125 Ambergate Ct",
      city: "Morrisville",
      zip: "27560",
      bedrooms: 4,
      fullBaths: 3,
      halfBaths: 1,
      sqft: 2950,
      hasPets: false,
      accessNotes: "Smart lock; the office sends a one-time code.",
    },
  },
  {
    fullName: "Chloe Abernathy",
    email: "chloe.abernathy@mail.example",
    phone: "(919) 555-0158",
    home: {
      addressLine1: "608 Primrose Hollow Rd",
      city: "Raleigh",
      zip: "27616",
      bedrooms: 3,
      fullBaths: 2,
      halfBaths: 0,
      sqft: 1900,
      hasPets: true,
      petNotes: "Indoor rabbit in a pen in the sunroom.",
      accessNotes: "Lockbox by the garage, code 7720.",
    },
  },
];
