export const TIME_OPTIONS: string[] = [];
// Generate: "9:00", "9:15", "9:30", "9:45", "10:00", ... "21:00"
for (let h = 9; h <= 21; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 21 && m > 0) break;
    TIME_OPTIONS.push(`${h}:${String(m).padStart(2, "0")}`);
  }
}
