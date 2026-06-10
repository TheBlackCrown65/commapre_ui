"""
Generate test data for k6 load testing.
Creates dummy PNG images and packs them into ZIP files.

Usage:
    python generate_test_data.py --pages 10
    python generate_test_data.py --pages 50 --count 5
"""
import os
import sys
import argparse
import zipfile
from PIL import Image, ImageDraw, ImageFont
import random

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "test_data")


def create_test_image(filename, width=1080, height=1920):
    """Create a test image with random colors and text."""
    bg_color = (random.randint(200, 255), random.randint(200, 255), random.randint(200, 255))
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    # Draw some rectangles to simulate UI elements
    for i in range(8):
        x = random.randint(20, width - 200)
        y = random.randint(50, height - 100)
        w = random.randint(100, 300)
        h = random.randint(40, 80)
        color = (random.randint(50, 200), random.randint(50, 200), random.randint(50, 200))
        draw.rectangle([x, y, x + w, y + h], fill=color)

    # Add filename text
    try:
        draw.text((50, 50), filename, fill=(0, 0, 0))
    except:
        pass

    return img


def generate_zip(zip_path, page_names, width=1080, height=1920):
    """Generate a ZIP file containing test images."""
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name in page_names:
            img = create_test_image(name, width, height)
            img_path = os.path.join(OUTPUT_DIR, name)
            img.save(img_path)
            zf.write(img_path, name)
            os.remove(img_path)
    
    size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"  Created: {zip_path} ({size_mb:.1f} MB, {len(page_names)} pages)")


def main():
    parser = argparse.ArgumentParser(description="Generate test data for k6 load testing")
    parser.add_argument("--pages", type=int, default=10, help="Number of pages per ZIP (default: 10)")
    parser.add_argument("--count", type=int, default=1, help="Number of ZIP files to create (default: 1)")
    parser.add_argument("--width", type=int, default=1080, help="Image width (default: 1080)")
    parser.add_argument("--height", type=int, default=1920, help="Image height (default: 1920)")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    page_names = [f"Page_{i+1:03d}.png" for i in range(args.pages)]

    print(f"Generating {args.count} ZIP file(s) with {args.pages} pages each ({args.width}x{args.height})...")

    for i in range(args.count):
        suffix = f"_{i+1}" if args.count > 1 else ""
        zip_path = os.path.join(OUTPUT_DIR, f"test_{args.pages}pages{suffix}.zip")
        generate_zip(zip_path, page_names, args.width, args.height)

    print(f"\nDone! Files saved to: {OUTPUT_DIR}")
    print(f"\nNext: Update tests/load_test.js with your flow_id and API key, then run:")
    print(f"  k6 run tests/load_test.js")


if __name__ == "__main__":
    main()
