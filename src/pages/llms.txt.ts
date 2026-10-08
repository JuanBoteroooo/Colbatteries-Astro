import { groups } from '../data/catalogs.js';

const SITE = 'https://www.colbateries.com';

export function GET() {
  const catalogLines = groups.flatMap((g: any) => [
    `\n### ${g.name}`,
    ...g.catalogs.map((c: any) => `- [${c.label}](${SITE}/catalogo/${c.slug}/)`),
  ]);

  const body = `# Colbateries S.A.

> Distribuidor mayorista de relojería en la Zona Libre de Colón, Panamá: movimientos de reloj, baterías, correas (pulsos), cristales, coronas, herramientas, relojes Polemik y Xinjia, gorras y accesorios. Vende al por mayor a relojerías, talleres y distribuidores, con envíos a toda Latinoamérica y el Caribe.

## Datos de contacto
- Dirección: Manzana 28, Local 8A, Torre Cofrisa 9, Zona Libre de Colón, Panamá
- Horario: 8:30 a. m. a 5:30 p. m. (hora de Panamá)
- WhatsApp: +507 6415-6382 (https://wa.me/50764156382)
- Teléfonos: +507 441-1617 y +507 441-1614
- Correo: colbateriespanamazl@hotmail.com
- Facebook: https://www.facebook.com/ColbatteriesPanama
- Instagram: https://www.instagram.com/colbatteries_sa

## Marcas
Movimientos Miyota, ETA, Ronda, Epson, SII e ISA; baterías Renata, GP, Maxell y Tianqiu; relojes Polemik y Xinjia; herramientas Horotec.

## Páginas principales
- [Inicio](${SITE}/)
- [Catálogos](${SITE}/catalogo/)
- [Nosotros y preguntas frecuentes](${SITE}/nosotros/)
- [Contacto](${SITE}/contacto/)

## Catálogos (cada uno tiene su lista de productos y un PDF descargable)
${catalogLines.join('\n')}
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
