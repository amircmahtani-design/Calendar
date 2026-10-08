export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#FF3B30' },
  { name: 'Orange', hex: '#FF9500' },
  { name: 'Yellow', hex: '#FFCC00' },
  { name: 'Green', hex: '#34C759' },
  { name: 'Teal', hex: '#30B0C7' },
  { name: 'Blue', hex: '#007AFF' },
  { name: 'Indigo', hex: '#5856D6' },
  { name: 'Purple', hex: '#AF52DE' },
  { name: 'Pink', hex: '#FF2D55' },
  { name: 'Brown', hex: '#A2845E' },
  { name: 'Grey', hex: '#8E8E93' },
];

export function colorOf(occColor: string | null | undefined, calColor: string | undefined) {
  return occColor || calColor || '#8E8E93';
}
