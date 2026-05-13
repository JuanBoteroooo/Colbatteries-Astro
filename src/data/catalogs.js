export const groups = [
  {
    id: 'correas',
    name: 'Pulsos & Correas',
    image: '/images/categorias/cuero-categoria.png',
    catalogs: [
      { slug: 'pulso-resina',    label: 'Pulso Resina',    structured: true },
      { slug: 'pulso-silicona',  label: 'Pulso Silicona',  structured: true },
      { slug: 'pulso-cuero',     label: 'Pulso de Cuero',  structured: true },
      { slug: 'pulso-metalico',  label: 'Pulso Metálico',  structured: true },
      { slug: 'pulso-pvc',       label: 'Pulso PVC',       structured: true },
    ],
  },
  {
    id: 'baterias',
    name: 'Baterías & Pilas',
    image: '/images/categorias/bateria-categoria.png',
    catalogs: [
      { slug: 'baterias-gp',       label: 'Baterías GP',       structured: true },
      { slug: 'baterias-tianqiu',  label: 'Baterías Tianqiu',  structured: true },
      { slug: 'baterias-maxell',   label: 'Baterías Maxell',   structured: true },
      { slug: 'pilas-economicas',  label: 'Pilas Económicas',  structured: true },
      { slug: 'capacitores',       label: 'Capacitores',       structured: true },
    ],
  },
  {
    id: 'movimientos',
    name: 'Movimientos',
    image: '/images/categorias/movimiento-categoria.png',
    catalogs: [
      { slug: 'movimientos-epson',  label: 'Movimientos EPSON',         structured: true },
      { slug: 'movimientos-sii',    label: 'Movimientos SII',           structured: true },
      { slug: 'movimientos-eta',    label: 'Movimientos ETA',          structured: true },
      { slug: 'movimientos-isa',    label: 'Movimientos ISA',          structured: true },
      { slug: 'movimientos-chinos', label: 'Movimientos Chinos',       structured: true },
      { slug: 'movimientos-miyota', label: 'Movimientos Miyota',       structured: true },
      { slug: 'movimientos-ronda',  label: 'Movimientos Ronda',        structured: true },
    ],
  },
  {
    id: 'relojes',
    name: 'Relojes',
    image: '/images/categorias/reloj-categoria.png',
    catalogs: [
      { slug: 'relojes-polemik',  label: 'Reloj Polemik',    structured: true },
      { slug: 'relojes-xinjia',   label: 'Relojes Xinjia',   structured: true },
    ],
  },
  {
    id: 'accesorios',
    name: 'Accesorios',
    image: '/images/categorias/accesorio-categoria.png',
    catalogs: [
      { slug: 'coronas',           label: 'Coronas',              structured: true },
      { slug: 'vidrios',           label: 'Vidrios',              structured: true },
      { slug: 'modulos',           label: 'Módulos',              structured: true },
      { slug: 'insumos-relojeria', label: 'Insumos de Relojería', structured: true },
    ],
  },
  {
    id: 'herramientas',
    name: 'Herramientas',
    image: '/images/categorias/herramienta-categoria.png',
    catalogs: [
      { slug: 'herramientas',         label: 'Herramientas de Relojería', structured: true },
      { slug: 'joyeria-herramientas', label: 'Joyería & Herramientas',    structured: true },
    ],
  },
  {
    id: 'Gorras',
    name: 'Gorras',
    image: '/images/categorias/gorra-categoria.png',
    catalogs: [
      { slug: 'gorras-polemik', label: 'Gorras Polemik', structured: true },
      { slug: 'gorras-lisas',   label: 'Gorras Lisas',   structured: true },
    ],
  },
];

export const allCatalogs = groups.flatMap(g =>
  g.catalogs.map(c => ({ ...c, group: g.name, groupId: g.id, image: g.image }))
);
