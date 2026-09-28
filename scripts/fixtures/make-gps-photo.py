"""
Builds the test photo for scripts/check-photo-prepare.mjs (roadmap M2.3, M2.6).

A committed .jpg with no explanation is a fixture that rots. This is the explanation: run
`python3 scripts/fixtures/make-gps-photo.py` (needs pillow and piexif) to rebuild it byte for byte.

What it makes is a photo the way a phone really stores one: the pixels are on their side (200x400)
with an EXIF Orientation tag saying "rotate this to display", plus the things a camera adds that
nobody means to publish - the exact coordinates the shot was taken at, the time, and the phone's
make. The coordinates are a real place (Columbia, South Carolina) precisely so that a failure of
the test is legible: if the check ever passes something through, the thing it passed is somebody's
home address.
"""
from PIL import Image
import piexif

stored = Image.new("RGB", (200, 400), (30, 30, 30))
for y in range(400):
    for x in range(200):
        stored.putpixel((x, y), (x % 255, (y // 2) % 255, 90))
# A white square in the stored top-left, so which way up the result came out is visible.
for y in range(40):
    for x in range(40):
        stored.putpixel((x, y), (255, 255, 255))

exif = {
    "0th": {
        piexif.ImageIFD.Orientation: 6,           # "rotate 90 clockwise to display"
        piexif.ImageIFD.Make: b"Kleit Test Phone",
    },
    "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2026:09:28 10:00:00"},
    "GPS": {
        piexif.GPSIFD.GPSLatitudeRef: b"N",
        piexif.GPSIFD.GPSLatitude: ((34, 1), (0, 1), (5400, 100)),
        piexif.GPSIFD.GPSLongitudeRef: b"W",
        piexif.GPSIFD.GPSLongitude: ((81, 1), (1, 1), (3000, 100)),
    },
    "1st": {},
    "thumbnail": None,
}
stored.save("scripts/fixtures/gps-photo.jpg", exif=piexif.dump(exif), quality=90)
print("wrote scripts/fixtures/gps-photo.jpg")
