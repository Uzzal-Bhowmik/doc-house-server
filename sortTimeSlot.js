function getStartTime(slot) {
  const match = slot.match(/(\d+:\d+ [APM]{2})/);
  if (match) {
    const timeString = match[0];
    const [hours, minutes] = timeString.split(":").map(Number);
    if (timeString.includes("PM") && hours !== 12) {
      return hours + 12;
    } else if (timeString.includes("AM") && hours === 12) {
      return 0;
    } else {
      return hours;
    }
  }
  return 0;
}

function compareStartTimes(slotA, slotB) {
  const startTimeA = getStartTime(slotA.slot);
  const startTimeB = getStartTime(slotB.slot);
  return startTimeA - startTimeB;
}

module.exports = { compareStartTimes };
