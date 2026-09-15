/** Physical inputs retain SDL button IDs in events and saved seat settings. */
export function quakeMouseButton(physicalButton: number): number {
  return physicalButton === 2 ? 3 : physicalButton === 3 ? 2 : physicalButton;
}

export function physicalMouseButton(quakeButton: number): number {
  return quakeMouseButton(quakeButton);
}
