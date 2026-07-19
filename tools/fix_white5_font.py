from pathlib import Path

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates

FONT_PATH = Path("White5-Regular Font.ttf")


def remove_contour(font: TTFont, glyph_name: str, contour_index: int) -> None:
    glyph = font["glyf"][glyph_name]
    if glyph.isComposite():
        raise ValueError(f"{glyph_name} is composite")

    coordinates, end_points, flags = glyph.getCoordinates(font["glyf"])
    starts = [0] + [end + 1 for end in end_points[:-1]]
    start = starts[contour_index]
    end = end_points[contour_index]
    removed_count = end - start + 1

    glyph.coordinates = GlyphCoordinates(
        list(coordinates[:start]) + list(coordinates[end + 1 :])
    )
    glyph.flags = bytearray(list(flags[:start]) + list(flags[end + 1 :]))
    glyph.endPtsOfContours = [
        point if point < start else point - removed_count
        for index, point in enumerate(end_points)
        if index != contour_index
    ]
    glyph.numberOfContours = len(glyph.endPtsOfContours)
    glyph.recalcBounds(font["glyf"])


def main() -> None:
    font = TTFont(FONT_PATH)

    # Remove the tiny accidental dot contours visible inside lowercase g and y.
    remove_contour(font, "g", 1)
    remove_contour(font, "y", 1)

    # Tighten the letter combinations that looked detached in words such as
    # Calgary, Margaret, and Frequently.
    feature_code = """
languagesystem DFLT dflt;
feature kern {
  pos l g -120;
  pos r g -140;
  pos r y -140;
  pos l y -120;
} kern;
"""
    addOpenTypeFeaturesFromString(font, feature_code)

    for record in font["name"].names:
        if record.nameID != 5:
            continue
        value = "Version 001.002"
        encoding = "utf-16-be" if record.platformID == 3 else "mac_roman"
        record.string = value.encode(encoding)

    font.save(FONT_PATH)

    # Validate the generated font before allowing the workflow to commit it.
    checked = TTFont(FONT_PATH)
    assert checked["glyf"]["g"].numberOfContours == 3
    assert checked["glyf"]["y"].numberOfContours == 2
    assert "GPOS" in checked
    checked.close()


if __name__ == "__main__":
    main()
