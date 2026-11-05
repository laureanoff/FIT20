import type { FoodItem, FoodState } from '../../types/domain.ts';

/**
 * Base inicial de alimentos comunes en Argentina.
 * Valores aproximados por 100 g (o 100 ml) tomados de tablas de composición de referencia
 * (USDA FoodData Central / ARGENFOODS). Son ESTIMACIONES: varían según marca, corte y preparación.
 *
 * Crudo vs. cocido: los alimentos que cambian mucho de peso al cocinarse (carnes, arroz, fideos,
 * legumbres, papa) tienen dos entradas separadas. 100 g de arroz crudo ≈ 280 g cocido:
 * confundirlos multiplica el error casi por 3.
 */
function f(
  id: string,
  name: string,
  category: string,
  state: FoodState,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  portions: Record<string, number> = {},
  is_liquid = false,
): FoodItem {
  return { id, name, category, state, kcal, protein, carbs, fat, portions, is_liquid, user_id: null };
}

export const FOODS: readonly FoodItem[] = [
  // Carnes y pescados
  f('pollo-pechuga-cruda', 'Pechuga de pollo sin piel', 'Carnes', 'raw', 120, 22.5, 0, 2.6, { 'pechuga chica': 150 }),
  f('pollo-pechuga-cocida', 'Pechuga de pollo a la plancha', 'Carnes', 'cooked', 165, 31, 0, 3.6, { porción: 120 }),
  f('pollo-muslo-crudo', 'Muslo de pollo sin piel', 'Carnes', 'raw', 121, 19.7, 0, 4.1, { unidad: 100 }),
  f('pollo-muslo-cocido', 'Muslo de pollo al horno sin piel', 'Carnes', 'cooked', 176, 24.8, 0, 8, { unidad: 75 }),
  f('vaca-magra-cruda', 'Carne vacuna magra (nalga, cuadrada, peceto)', 'Carnes', 'raw', 130, 21, 0, 5, { bife: 180 }),
  f('vaca-magra-cocida', 'Carne vacuna magra a la plancha', 'Carnes', 'cooked', 190, 30, 0, 7.5, { bife: 130 }),
  f('vaca-bife-chorizo-crudo', 'Bife de chorizo', 'Carnes', 'raw', 200, 20, 0, 13, { bife: 250 }),
  f('vaca-asado-crudo', 'Asado de tira', 'Carnes', 'raw', 290, 16, 0, 25, { porción: 300 }),
  f('vaca-picada-comun-cruda', 'Carne picada común', 'Carnes', 'raw', 254, 17.2, 0, 20),
  f('vaca-picada-especial-cruda', 'Carne picada especial (magra)', 'Carnes', 'raw', 176, 20, 0, 10),
  f('vaca-picada-especial-cocida', 'Carne picada especial cocida', 'Carnes', 'cooked', 217, 26, 0, 11.8),
  f('cerdo-lomo-crudo', 'Lomo de cerdo', 'Carnes', 'raw', 143, 21, 0, 6),
  f('milanesa-carne-frita', 'Milanesa de carne frita', 'Carnes', 'cooked', 260, 18, 14, 15, { unidad: 150 }),
  f('milanesa-pollo-horno', 'Milanesa de pollo al horno', 'Carnes', 'cooked', 210, 21, 13, 8, { unidad: 140 }),
  f('merluza-cruda', 'Merluza (filet)', 'Pescados', 'raw', 89, 17.5, 0, 1.9, { filet: 150 }),
  f('merluza-cocida', 'Merluza al horno', 'Pescados', 'cooked', 105, 21, 0, 2, { filet: 120 }),
  f('atun-natural', 'Atún al natural (escurrido)', 'Pescados', 'na', 116, 25.5, 0, 0.8, { lata: 120 }),
  f('atun-aceite', 'Atún en aceite (escurrido)', 'Pescados', 'na', 198, 29, 0, 8.2, { lata: 120 }),

  // Huevos y lácteos
  f('huevo-entero', 'Huevo entero', 'Huevos', 'raw', 143, 12.6, 0.7, 9.5, { unidad: 50 }),
  f('huevo-duro', 'Huevo duro', 'Huevos', 'cooked', 155, 12.6, 1.1, 10.6, { unidad: 50 }),
  f('clara-huevo', 'Clara de huevo', 'Huevos', 'raw', 52, 10.9, 0.7, 0.2, { unidad: 33 }),
  f('leche-entera', 'Leche entera', 'Lácteos', 'na', 61, 3.2, 4.8, 3.3, { vaso: 200, taza: 250 }, true),
  f('leche-parcial', 'Leche parcialmente descremada', 'Lácteos', 'na', 46, 3.2, 4.9, 1.5, { vaso: 200, taza: 250 }, true),
  f('leche-descremada', 'Leche descremada', 'Lácteos', 'na', 35, 3.4, 5, 0.1, { vaso: 200, taza: 250 }, true),
  f('yogur-entero', 'Yogur natural entero', 'Lácteos', 'na', 61, 3.5, 4.7, 3.3, { pote: 190 }),
  f('yogur-descremado-bebible', 'Yogur bebible descremado', 'Lácteos', 'na', 40, 3, 6, 0.1, { vaso: 200 }, true),
  f('yogur-griego', 'Yogur griego natural', 'Lácteos', 'na', 97, 9, 4, 5, { pote: 160 }),
  f('queso-cremoso', 'Queso cremoso', 'Lácteos', 'na', 290, 18, 1, 24, { feta: 30 }),
  f('queso-mozzarella', 'Mozzarella', 'Lácteos', 'na', 300, 22, 2.2, 22, { porción: 30 }),
  f('queso-rallado', 'Queso rallado tipo reggianito', 'Lácteos', 'na', 390, 32, 3, 28, { cucharada: 10 }),
  f('queso-untable-light', 'Queso untable descremado', 'Lácteos', 'na', 120, 11, 4, 6, { cucharada: 15 }),
  f('ricota-entera', 'Ricota entera', 'Lácteos', 'na', 174, 11.3, 3, 13, { cucharada: 30 }),
  f('ricota-descremada', 'Ricota descremada', 'Lácteos', 'na', 100, 10, 4, 4, { cucharada: 30 }),

  // Cereales, panes y tubérculos
  f('arroz-blanco-crudo', 'Arroz blanco', 'Cereales', 'raw', 360, 6.6, 79, 0.6, { taza: 185 }),
  f('arroz-blanco-cocido', 'Arroz blanco cocido', 'Cereales', 'cooked', 130, 2.7, 28, 0.3, { taza: 160, plato: 250 }),
  f('arroz-integral-crudo', 'Arroz integral', 'Cereales', 'raw', 362, 7.5, 76, 2.7, { taza: 190 }),
  f('arroz-integral-cocido', 'Arroz integral cocido', 'Cereales', 'cooked', 123, 2.7, 25.6, 1, { taza: 195 }),
  f('fideos-crudos', 'Fideos secos', 'Cereales', 'raw', 371, 13, 75, 1.5, { porción: 80 }),
  f('fideos-cocidos', 'Fideos cocidos', 'Cereales', 'cooked', 158, 5.8, 31, 0.9, { plato: 220 }),
  f('avena', 'Avena arrollada', 'Cereales', 'raw', 379, 13, 68, 6.5, { cucharada: 10, taza: 80 }),
  f('pan-frances', 'Pan francés', 'Panes', 'na', 270, 8.5, 55, 1.5, { mignon: 40, flauta: 250 }),
  f('pan-lactal', 'Pan lactal blanco', 'Panes', 'na', 265, 8, 49, 3.6, { rebanada: 25 }),
  f('pan-lactal-integral', 'Pan lactal integral', 'Panes', 'na', 250, 9, 43, 4, { rebanada: 27 }),
  f('galletas-arroz', 'Galletas de arroz', 'Panes', 'na', 387, 8, 81, 2.8, { unidad: 9 }),
  f('galletitas-agua', 'Galletitas de agua', 'Panes', 'na', 420, 10, 70, 11, { unidad: 6 }),
  f('medialuna', 'Medialuna de manteca', 'Panes', 'na', 410, 7, 45, 21, { unidad: 40 }),
  f('papa-cruda', 'Papa', 'Tubérculos', 'raw', 77, 2, 17, 0.1, { mediana: 170 }),
  f('papa-hervida', 'Papa hervida', 'Tubérculos', 'cooked', 87, 1.9, 20, 0.1, { mediana: 150 }),
  f('papas-fritas', 'Papas fritas', 'Tubérculos', 'cooked', 312, 3.4, 41, 15, { porción: 120 }),
  f('batata-cruda', 'Batata', 'Tubérculos', 'raw', 86, 1.6, 20, 0.1, { mediana: 200 }),
  f('batata-horno', 'Batata al horno', 'Tubérculos', 'cooked', 90, 2, 20.7, 0.2, { mediana: 180 }),

  // Legumbres
  f('lentejas-crudas', 'Lentejas secas', 'Legumbres', 'raw', 352, 24.6, 63, 1.1, { porción: 60 }),
  f('lentejas-cocidas', 'Lentejas cocidas', 'Legumbres', 'cooked', 116, 9, 20, 0.4, { taza: 200 }),
  f('garbanzos-crudos', 'Garbanzos secos', 'Legumbres', 'raw', 364, 19, 61, 6, { porción: 60 }),
  f('garbanzos-cocidos', 'Garbanzos cocidos', 'Legumbres', 'cooked', 164, 8.9, 27.4, 2.6, { taza: 165 }),
  f('porotos-negros-crudos', 'Porotos negros secos', 'Legumbres', 'raw', 341, 21.6, 62, 1.4, { porción: 60 }),
  f('porotos-negros-cocidos', 'Porotos negros cocidos', 'Legumbres', 'cooked', 132, 8.9, 23.7, 0.5, { taza: 170 }),

  // Frutas
  f('banana', 'Banana', 'Frutas', 'na', 89, 1.1, 23, 0.3, { unidad: 120 }),
  f('manzana', 'Manzana', 'Frutas', 'na', 52, 0.3, 14, 0.2, { unidad: 180 }),
  f('naranja', 'Naranja', 'Frutas', 'na', 47, 0.9, 12, 0.1, { unidad: 180 }),
  f('mandarina', 'Mandarina', 'Frutas', 'na', 53, 0.8, 13, 0.3, { unidad: 90 }),
  f('frutilla', 'Frutillas', 'Frutas', 'na', 32, 0.7, 7.7, 0.3, { taza: 150 }),
  f('pera', 'Pera', 'Frutas', 'na', 57, 0.4, 15, 0.1, { unidad: 170 }),
  f('durazno', 'Durazno', 'Frutas', 'na', 39, 0.9, 9.5, 0.3, { unidad: 150 }),
  f('uva', 'Uvas', 'Frutas', 'na', 69, 0.7, 18, 0.2, { racimo: 150 }),
  f('kiwi', 'Kiwi', 'Frutas', 'na', 61, 1.1, 15, 0.5, { unidad: 75 }),
  f('palta', 'Palta', 'Frutas', 'na', 160, 2, 8.5, 14.7, { media: 100 }),

  // Verduras
  f('lechuga', 'Lechuga', 'Verduras', 'raw', 15, 1.4, 2.9, 0.2, { plato: 60 }),
  f('tomate', 'Tomate', 'Verduras', 'raw', 18, 0.9, 3.9, 0.2, { unidad: 120 }),
  f('zanahoria', 'Zanahoria', 'Verduras', 'raw', 41, 0.9, 9.6, 0.2, { unidad: 70 }),
  f('brocoli-crudo', 'Brócoli', 'Verduras', 'raw', 34, 2.8, 6.6, 0.4),
  f('brocoli-hervido', 'Brócoli hervido', 'Verduras', 'cooked', 35, 2.4, 7.2, 0.4, { taza: 155 }),
  f('zapallo-anco-cocido', 'Zapallo anco al horno', 'Verduras', 'cooked', 40, 0.9, 10.5, 0.1, { porción: 200 }),
  f('zapallito', 'Zapallito', 'Verduras', 'raw', 17, 1.2, 3.1, 0.3, { unidad: 150 }),
  f('cebolla', 'Cebolla', 'Verduras', 'raw', 40, 1.1, 9.3, 0.1, { unidad: 110 }),
  f('espinaca', 'Espinaca', 'Verduras', 'raw', 23, 2.9, 3.6, 0.4),
  f('acelga-cocida', 'Acelga cocida', 'Verduras', 'cooked', 20, 1.9, 4.1, 0.1, { taza: 175 }),
  f('berenjena', 'Berenjena', 'Verduras', 'raw', 25, 1, 5.9, 0.2, { unidad: 300 }),
  f('morron', 'Morrón', 'Verduras', 'raw', 26, 1, 6, 0.3, { unidad: 150 }),
  f('choclo-cocido', 'Choclo cocido', 'Verduras', 'cooked', 96, 3.4, 21, 1.5, { unidad: 100 }),

  // Frutos secos y grasas
  f('mani-tostado', 'Maní tostado sin sal', 'Frutos secos', 'na', 585, 24.4, 21.5, 49.7, { puñado: 30 }),
  f('almendras', 'Almendras', 'Frutos secos', 'na', 579, 21, 22, 50, { puñado: 30 }),
  f('nueces', 'Nueces', 'Frutos secos', 'na', 654, 15, 14, 65, { puñado: 30 }),
  f('pasta-mani', 'Pasta de maní', 'Frutos secos', 'na', 588, 25, 20, 50, { cucharada: 16 }),
  f('aceite', 'Aceite (girasol / oliva)', 'Grasas', 'na', 884, 0, 0, 100, { cucharada: 13, cucharadita: 4.5 }),
  f('manteca', 'Manteca', 'Grasas', 'na', 717, 0.9, 0.1, 81, { cucharadita: 5 }),

  // Dulces y otros
  f('dulce-de-leche', 'Dulce de leche', 'Dulces', 'na', 315, 6.8, 55, 7.3, { cucharada: 20 }),
  f('azucar', 'Azúcar', 'Dulces', 'na', 387, 0, 100, 0, { cucharadita: 5 }),
  f('mermelada', 'Mermelada', 'Dulces', 'na', 250, 0.4, 62, 0.1, { cucharada: 20 }),
  f('miel', 'Miel', 'Dulces', 'na', 304, 0.3, 82, 0, { cucharada: 21 }),
  f('empanada-carne', 'Empanada de carne al horno', 'Comidas', 'cooked', 270, 11, 27, 13, { unidad: 90 }),
  f('pizza-muzzarella', 'Pizza de muzzarella', 'Comidas', 'cooked', 270, 11, 30, 11, { porción: 120 }),

  // Bebidas
  f('agua', 'Agua', 'Bebidas', 'na', 0, 0, 0, 0, { vaso: 250 }, true),
  f('gaseosa', 'Gaseosa común', 'Bebidas', 'na', 42, 0, 10.6, 0, { vaso: 250 }, true),
  f('gaseosa-light', 'Gaseosa sin azúcar', 'Bebidas', 'na', 0.4, 0, 0.1, 0, { vaso: 250 }, true),
  f('jugo-naranja', 'Jugo de naranja exprimido', 'Bebidas', 'na', 45, 0.7, 10.4, 0.2, { vaso: 200 }, true),
  f('cafe', 'Café sin azúcar', 'Bebidas', 'na', 2, 0.1, 0, 0, { taza: 150 }, true),
  f('mate-amargo', 'Mate amargo (cebado)', 'Bebidas', 'na', 2, 0.1, 0.3, 0, { mate: 50 }, true),
  f('cerveza', 'Cerveza', 'Bebidas', 'na', 43, 0.5, 3.6, 0, { lata: 473, vaso: 250 }, true),
  f('vino', 'Vino tinto', 'Bebidas', 'na', 85, 0.1, 2.6, 0, { copa: 150 }, true),
];

/**
 * Factores de rendimiento crudo→cocido (peso cocido / peso crudo), aproximados.
 * Permite convertir "pesé 80 g de fideos secos" ↔ "comí 185 g cocidos".
 */
export const COOKING_YIELD: Record<string, number> = {
  'arroz-blanco': 2.8,
  'arroz-integral': 2.5,
  fideos: 2.3,
  lentejas: 2.5,
  garbanzos: 2.2,
  'porotos-negros': 2.3,
  'pollo-pechuga': 0.75,
  'vaca-magra': 0.72,
  merluza: 0.8,
};

export function getFood(id: string, extra: readonly FoodItem[] = []): FoodItem | undefined {
  return FOODS.find((x) => x.id === id) ?? extra.find((x) => x.id === id);
}
