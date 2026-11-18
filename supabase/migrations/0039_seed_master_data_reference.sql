-- 0039 — master data reference seed
--
-- WHAT IS SEEDED, AND WHY. The rule for Phase 2 is that a seed may only contain something that
-- is a published standard or a physical fact. Anything that is a commercial or tax decision is
-- left empty and flagged in the UI:
--
--   seeded      units of measure (SI/CGS names, symbols and mass facts), ISO 4217 currencies,
--               Incoterms 2020 rule codes, illustrative payment terms shipped INACTIVE
--   NOT seeded  supplier and customer records, product categories, products, warehouses, sites,
--               exchange rates, tax categories, approval-related values, payment terms activated
--
-- The illustrative payment terms are marked `is_seeded_template = true` and `is_active = false`:
-- they exist so an administrator can copy or adopt one, not because Pluck Agro has agreed them.

-- ---------------------------------------------------------------- units of measure
insert into public.units_of_measure (code, name, symbol, category, precision, is_base_unit, is_active, notes)
values
  ('kg',   'Kilogram',      'kg',  'MASS',      3, true,  true, 'SI base unit of mass'),
  ('g',    'Gram',          'g',   'MASS',      3, false, true, null),
  ('mg',   'Milligram',     'mg',  'MASS',      3, false, true, null),
  ('MT',   'Metric tonne',  't',   'MASS',      3, false, true, '1 MT = 1,000 kg'),
  ('lb',   'Pound',         'lb',  'MASS',      3, false, true, '1 lb = 0.45359237 kg exactly'),
  ('L',    'Litre',         'L',   'VOLUME',    3, true,  true, 'SI-derived unit of volume'),
  ('mL',   'Millilitre',    'mL',  'VOLUME',    3, false, true, null),
  ('m3',   'Cubic metre',   'm³',  'VOLUME',    3, false, true, null),
  ('pcs',  'Piece',         'pcs', 'COUNT',     0, true,  true, null),
  ('m',    'Metre',         'm',   'LENGTH',    2, true,  true, null),
  ('m2',   'Square metre',  'm²',  'AREA',      2, true,  true, null),
  ('hr',   'Hour',          'h',   'TIME',      2, true,  true, null),
  ('bag',  'Bag',           'bag', 'PACKAGING', 0, false, true, 'Packaging unit. No weight is implied: a bag conversion must be configured per product.'),
  ('drum', 'Drum',          'drum','PACKAGING', 0, false, true, 'Packaging unit. No volume or weight is implied.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- standard conversions
-- Only physical facts. 1 MT = 1,000 kg and 1 kg = 1,000 g are definitions, not policy.
-- No packaging conversion is seeded: "1 bag = 25 kg" is true only for products that have been
-- verified to pack 25 kg, so it can only be created as a product-specific rule.
insert into public.unit_conversions (from_unit_id, to_unit_id, conversion_factor, conversion_method, effective_from, notes)
select f.id, t.id, v.factor, 'multiply', date '2026-01-01', v.note
  from (values
    ('MT', 'kg', 1000.000000000000, 'Definition of the metric tonne'),
    ('kg', 'g',  1000.000000000000, 'Definition of the kilogram'),
    ('g',  'mg', 1000.000000000000, 'Definition of the gram'),
    ('L',  'mL', 1000.000000000000, 'Definition of the litre'),
    ('lb', 'kg', 0.453592370000,    'International avoirdupois pound, exact')
  ) as v(from_code, to_code, factor, note)
  join public.units_of_measure f on f.code = v.from_code
  join public.units_of_measure t on t.code = v.to_code
on conflict do nothing;

-- ---------------------------------------------------------------- currencies (ISO 4217)
-- Currencies are seeded INACTIVE except none: which currencies Pluck Agro actually trades in is
-- a Finance decision (spec §11). They are present so a Finance user can activate without typing
-- ISO data by hand.
insert into public.currencies (code, name, symbol, decimal_places, is_active, notes)
values
  ('NGN', 'Nigerian Naira',          '₦', 2, true,  'Functional currency candidate — confirm with Finance'),
  ('USD', 'United States Dollar',    '$', 2, false, 'ISO 4217'),
  ('EUR', 'Euro',                    '€', 2, false, 'ISO 4217'),
  ('GBP', 'Pound Sterling',          '£', 2, false, 'ISO 4217'),
  ('XOF', 'West African CFA Franc',  'F', 0, false, 'ISO 4217')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- Incoterms 2020
-- Published ICC rule codes and their meaning. No shipment workflow uses them yet.
insert into public.delivery_terms (code, name, term_kind, edition, description, is_active)
values
  ('EXW', 'Ex Works',                       'incoterm', '2020', 'Seller makes goods available at its premises; buyer bears all onward cost and risk.', true),
  ('FCA', 'Free Carrier',                   'incoterm', '2020', 'Seller delivers to a carrier nominated by the buyer.', true),
  ('FAS', 'Free Alongside Ship',            'incoterm', '2020', 'Sea and inland waterway only. Seller delivers alongside the vessel.', true),
  ('FOB', 'Free On Board',                  'incoterm', '2020', 'Sea and inland waterway only. Seller delivers on board the vessel.', true),
  ('CFR', 'Cost and Freight',               'incoterm', '2020', 'Seller pays freight to destination; risk passes on loading.', true),
  ('CIF', 'Cost, Insurance and Freight',    'incoterm', '2020', 'As CFR plus insurance cover arranged by the seller.', true),
  ('CPT', 'Carriage Paid To',               'incoterm', '2020', 'Seller pays carriage to destination; risk passes to first carrier.', true),
  ('CIP', 'Carriage and Insurance Paid To', 'incoterm', '2020', 'As CPT plus insurance cover arranged by the seller.', true),
  ('DAP', 'Delivered At Place',             'incoterm', '2020', 'Seller delivers when goods are ready for unloading at destination.', true),
  ('DPU', 'Delivered At Place Unloaded',    'incoterm', '2020', 'Seller delivers and unloads at destination.', true),
  ('DDP', 'Delivered Duty Paid',            'incoterm', '2020', 'Seller bears all cost and risk including import duty.', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- payment terms (inactive templates)
-- Spec §12 examples. Shipped inactive and flagged: adopting one is a commercial decision.
insert into public.payment_terms (code, name, description, payment_days, payment_type, is_active, is_seeded_template)
values
  ('advance_payment',   'Advance Payment',        'Payment before goods are released.',            null, 'advance',          false, true),
  ('cash_on_delivery',  'Cash on Delivery',       'Payment on delivery of goods.',                 null, 'cash_on_delivery', false, true),
  ('immediate',         'Immediate Payment',      'Payment due on invoice receipt.',               0,    'immediate',        false, true),
  ('net_7',             '7 Days',                 'Payment due 7 days from invoice date.',         7,    'credit',           false, true),
  ('net_15',            '15 Days',                'Payment due 15 days from invoice date.',        15,   'credit',           false, true),
  ('net_30',            '30 Days',                'Payment due 30 days from invoice date.',        30,   'credit',           false, true),
  ('net_45',            '45 Days',                'Payment due 45 days from invoice date.',        45,   'credit',           false, true),
  ('net_60',            '60 Days',                'Payment due 60 days from invoice date.',        60,   'credit',           false, true),
  ('custom',            'Custom Terms',           'Negotiated per agreement; use the description.', null, 'custom',          false, true)
on conflict (code) do nothing;
