export const groups = [
  {
    id: 'correas',
    name: 'Pulsos & Correas',
    image: 'https://images.unsplash.com/photo-1614164185128-e4ec99c436d7?w=600&h=300&fit=crop&q=80',
    catalogs: [
      { slug: 'pulso-resina',    label: 'Pulso Resina' },
      { slug: 'pulso-silicona',  label: 'Pulso Silicona' },
      { slug: 'pulso-cuero',     label: 'Pulso de Cuero' },
      { slug: 'pulso-metalico',  label: 'Pulso Metálico' },
      { slug: 'pulso-pvc',       label: 'Pulso PVC' },
    ],
  },
  {
    id: 'baterias',
    name: 'Baterías & Pilas',
    image: 'https://images.unsplash.com/photo-1619641782842-83f2446c560b?q=80&w=1200&auto=format&fit=crop',
    catalogs: [
      { slug: 'baterias-gp',       label: 'Baterías GP' },
      { slug: 'baterias-tianqiu',  label: 'Baterías Tianqiu' },
      { slug: 'baterias-renata',   label: 'Baterías Renata' },
      { slug: 'baterias-maxell',   label: 'Baterías Maxell' },
      { slug: 'pilas-economicas',  label: 'Pilas Económicas' },
      { slug: 'capacitores',       label: 'Capacitores' },
    ],
  },
  {
    id: 'movimientos',
    name: 'Movimientos',
    image: 'https://images.unsplash.com/photo-1587836374828-4dbafa94cf0e?w=600&h=300&fit=crop&q=80',
    catalogs: [
      { slug: 'movimientos-epson',  label: 'Movimientos EPSON & SII' },
      { slug: 'movimientos-eta',    label: 'Movimientos ETA' },
      { slug: 'movimientos-isa',    label: 'Movimientos ISA & China' },
      { slug: 'movimientos-miyota', label: 'Movimientos Miyota' },
      { slug: 'movimientos-ronda',  label: 'Movimientos Ronda' },
    ],
  },
  {
    id: 'relojes',
    name: 'Relojes',
    image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=300&fit=crop&q=80',
    catalogs: [
      { slug: 'relojes-polemik',  label: 'Reloj Polemik' },
      { slug: 'relojes-surtidos', label: 'Relojes Surtidos' },
      { slug: 'relojes-xinjia',   label: 'Relojes Xinjia' },
    ],
  },
  {
    id: 'accesorios',
    name: 'Accesorios',
    image: 'https://images.unsplash.com/photo-1593152167544-085d3b9c4938?w=600&h=300&fit=crop&q=80',
    catalogs: [
      { slug: 'coronas',           label: 'Coronas' },
      { slug: 'vidrios',           label: 'Vidrios' },
      { slug: 'modulos',           label: 'Módulos' },
      { slug: 'insumos-relojeria', label: 'Insumos de Relojería' },
    ],
  },
  {
    id: 'herramientas',
    name: 'Herramientas',
    image: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=600&h=300&fit=crop&q=80',
    catalogs: [
      { slug: 'herramientas',        label: 'Herramientas de Relojería' },
      { slug: 'joyeria-herramientas', label: 'Joyería & Herramientas' },
    ],
  },
  {
    id: 'Gorras',
    name: 'Gorras',
    image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&h=300&fit=crop&q=80',
    catalogs: [
      { slug: 'gorras-polemik', label: 'Gorras Polemik' },
      { slug: 'gorras-lisas',   label: 'Gorras Lisas' },
    ],
  },
];

export const allCatalogs = groups.flatMap(g =>
  g.catalogs.map(c => ({ ...c, group: g.name, groupId: g.id, image: g.image }))
);
