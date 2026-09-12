// Builds the open graph share cards, one per catalogue item page.
//
//	npm run og                           after a drop, draws only the new ids
//	go run ./tools/ogcards -limit 24     a sample, to look at
//	go run ./tools/ogcards -ids 1000000  one card, for a spot check
//	go run ./tools/ogcards -force        redo the lot, after a design change
//
// A card already on disk is left alone, so the weekly run costs nothing for
// the 26k that have not moved. Redesign the card and you want -force here and
// a wipe of <DEPLOY_PATH>/avatar/og on the box, because deploy.mjs compares
// art by name and would otherwise think the box is already up to date.
//
// Every item page already ships an icon at .avatar-out/items/<id>.webp, so a
// card is that icon scaled up on a branded plate. Nothing in here knows how a
// character is composited, which is the point: lib/draw.ts stays the only
// place that does, and this cannot drift away from it.
//
// Output goes to .avatar-out/og, so deploy.mjs carries it along with the rest
// of the art and only sends ids the box has not seen before.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"

	// registers the webp decoder with image.Decode. the icons are VP8L,
	// lossless with alpha, which this reads. there is no encoder in x/image,
	// which is why the cards come out as png
	_ "golang.org/x/image/webp"
)

// the item page palette, from app/items/items.module.scss
var (
	bg     = color.RGBA{0x14, 0x14, 0x1a, 0xff}
	plate  = color.RGBA{0x19, 0x19, 0x20, 0xff}
	edge   = color.RGBA{0x2a, 0x2a, 0x34, 0xff}
	gold   = color.RGBA{0xff, 0xe3, 0x9a, 0xff}
	text   = color.RGBA{0xe8, 0xe8, 0xef, 0xff}
	dimmed = color.RGBA{0x8a, 0x8a, 0x99, 0xff}
)

// 1200x630 is what every scraper crops to, so it is what we draw
const (
	cardW = 1200
	cardH = 630

	plateX, plateY, plateSize = 80, 155, 320
	iconBox                   = 240

	colX     = 470
	colRight = 60
)

type Item struct {
	ID   int    `json:"id"`
	N    string `json:"n"`
	C    string `json:"c"`
	Cash int    `json:"cash"`
}

type digest struct {
	Items []Item `json:"items"`
}

func main() {
	var (
		itemsPath = flag.String("items", "data/items.json", "the catalogue digest")
		iconDir   = flag.String("icons", ".avatar-out/items", "per item icons")
		outDir    = flag.String("out", ".avatar-out/og", "where cards are written")
		limit     = flag.Int("limit", 0, "stop after n cards, 0 for all")
		jobs      = flag.Int("jobs", runtime.NumCPU(), "workers")
		force     = flag.Bool("force", false, "redraw cards already on disk")
		only      = flag.String("ids", "", "comma separated ids, for spot checks")
	)
	flag.Parse()

	pick := map[int]bool{}
	for _, s := range strings.Split(*only, ",") {
		if s = strings.TrimSpace(s); s != "" {
			n, err := strconv.Atoi(s)
			if err != nil {
				die("bad id %q", s)
			}
			pick[n] = true
		}
	}

	raw, err := os.ReadFile(*itemsPath)
	if err != nil {
		die("reading %s: %v", *itemsPath, err)
	}
	var d digest
	if err := json.Unmarshal(raw, &d); err != nil {
		die("parsing %s: %v", *itemsPath, err)
	}

	// the 151 items the client never translated have no name to put on a card,
	// and their pages are noindex anyway. same rule as isIndexable in lib/items
	todo := make([]Item, 0, len(d.Items))
	for _, it := range d.Items {
		if it.N == "" {
			continue
		}
		if len(pick) > 0 && !pick[it.ID] {
			continue
		}
		todo = append(todo, it)
		if *limit > 0 && len(todo) == *limit {
			break
		}
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		die("making %s: %v", *outDir, err)
	}

	fmt.Printf("%d cards, %d workers\n", len(todo), *jobs)
	start := time.Now()

	var done, skipped, failed, written atomic.Int64
	queue := make(chan Item)
	var wg sync.WaitGroup

	for i := 0; i < *jobs; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for it := range queue {
				dst := filepath.Join(*outDir, fmt.Sprintf("%d.png", it.ID))
				if !*force {
					if st, err := os.Stat(dst); err == nil && st.Size() > 0 {
						skipped.Add(1)
						continue
					}
				}
				n, err := build(it, *iconDir, dst)
				if err != nil {
					// a missing icon is not worth stopping 26k cards over
					if failed.Add(1) <= 10 {
						fmt.Printf("  %d: %v\n", it.ID, err)
					}
					continue
				}
				written.Add(n)
				if c := done.Add(1); c%2000 == 0 {
					fmt.Printf("  %d/%d\n", c, len(todo))
				}
			}
		}()
	}

	for _, it := range todo {
		queue <- it
	}
	close(queue)
	wg.Wait()

	made := done.Load()
	fmt.Printf("\n%d written, %d already there, %d failed, %s\n",
		made, skipped.Load(), failed.Load(), time.Since(start).Round(time.Millisecond))
	if made > 0 {
		fmt.Printf("%.1f MB total, %.1f kB average\n",
			float64(written.Load())/1e6, float64(written.Load())/float64(made)/1e3)
	}
}

// draws one card and writes it, returning the file size
func build(it Item, iconDir, dst string) (int64, error) {
	icon, err := loadIcon(filepath.Join(iconDir, fmt.Sprintf("%d.webp", it.ID)))
	if err != nil {
		return 0, err
	}

	card := image.NewRGBA(image.Rect(0, 0, cardW, cardH))
	draw.Draw(card, card.Bounds(), &image.Uniform{bg}, image.Point{}, draw.Src)

	// the plate the icon sits on, with a hairline so it reads as a surface
	// rather than a stain on the background
	pr := image.Rect(plateX, plateY, plateX+plateSize, plateY+plateSize)
	draw.Draw(card, pr, &image.Uniform{edge}, image.Point{}, draw.Src)
	draw.Draw(card, pr.Inset(1), &image.Uniform{plate}, image.Point{}, draw.Src)

	// whole number scale only. these are 30 pixel sprites and a fractional
	// scale puts a soft edge on art that is meant to have hard ones
	b := icon.Bounds()
	scale := iconBox / max(b.Dx(), b.Dy())
	if scale < 1 {
		scale = 1
	}
	w, h := b.Dx()*scale, b.Dy()*scale
	at := image.Rect(0, 0, w, h).Add(image.Pt(
		plateX+(plateSize-w)/2,
		plateY+(plateSize-h)/2,
	))
	draw.Draw(card, at, nearest{icon, scale}, image.Point{}, draw.Over)

	// the name takes whatever size still fits on one line
	name := ascii(it.N)
	if !readable(name) {
		name = fmt.Sprintf("Item %d", it.ID)
	}
	avail := cardW - colX - colRight
	ns := clamp(avail/(7*max(len(name), 1)), 2, 6)
	for len(name)*7*ns > avail && len(name) > 4 {
		name = name[:len(name)-4] + "..."
	}

	y := 250
	drawText(card, name, colX, y, ns, gold)
	y += 13*ns + 26

	kind := "REGULAR EQUIP"
	if it.Cash == 1 {
		kind = "CASH SHOP"
	}
	drawText(card, label(it.C)+"  /  "+kind, colX, y, 2, dimmed)

	draw.Draw(card, image.Rect(colX, 402, colX+150, 405), &image.Uniform{gold}, image.Point{}, draw.Src)
	drawText(card, "HENEHOE.APP", colX, 428, 3, text)

	return writePNG(dst, card)
}

func loadIcon(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("no icon")
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decoding icon: %w", err)
	}
	return img, nil
}

// nearest neighbour, as an image rather than a loop, so draw.Draw does the
// alpha compositing and this stays the only thing it has to know about
type nearest struct {
	src   image.Image
	scale int
}

func (n nearest) ColorModel() color.Model { return n.src.ColorModel() }

func (n nearest) Bounds() image.Rectangle {
	b := n.src.Bounds()
	return image.Rect(0, 0, b.Dx()*n.scale, b.Dy()*n.scale)
}

func (n nearest) At(x, y int) color.Color {
	b := n.src.Bounds()
	return n.src.At(b.Min.X+x/n.scale, b.Min.Y+y/n.scale)
}

// basicfont is a 7x13 bitmap, so scaling it by a whole number keeps the hard
// edges. that suits a pixel art tool better than a smooth face would, and it
// saves converting Regupix.woff2 into something go can read
func drawText(dst *image.RGBA, s string, x, y, scale int, c color.RGBA) {
	if s == "" {
		return
	}
	mask := image.NewAlpha(image.Rect(0, 0, len(s)*7, 13))
	(&font.Drawer{
		Dst:  mask,
		Src:  image.NewUniform(color.Alpha{A: 255}),
		Face: basicfont.Face7x13,
		Dot:  fixed.P(0, 11),
	}).DrawString(s)

	mb := mask.Bounds()
	for py := 0; py < mb.Dy(); py++ {
		for px := 0; px < mb.Dx(); px++ {
			if mask.AlphaAt(px, py).A == 0 {
				continue
			}
			for sy := 0; sy < scale; sy++ {
				for sx := 0; sx < scale; sx++ {
					dst.SetRGBA(x+px*scale+sx, y+py*scale+sy, c)
				}
			}
		}
	}
}

// the card is flat colour, pixel art and a 1 bit font, so it usually lands
// well under 256 distinct colours. saying so turns a 40 kB truecolour png into
// a 10 kB indexed one, losslessly. anything busier falls back to rgba
func writePNG(path string, img *image.RGBA) (int64, error) {
	f, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	var out image.Image = img
	if p := paletted(img); p != nil {
		out = p
	}
	if err := enc.Encode(f, out); err != nil {
		f.Close()
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return st.Size(), nil
}

func paletted(img *image.RGBA) *image.Paletted {
	idx := make(map[color.RGBA]uint8, 256)
	var pal color.Palette
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := img.RGBAAt(x, y)
			if _, ok := idx[c]; ok {
				continue
			}
			if len(pal) == 256 {
				return nil
			}
			idx[c] = uint8(len(pal))
			pal = append(pal, c)
		}
	}
	p := image.NewPaletted(b, pal)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			p.SetColorIndex(x, y, idx[img.RGBAAt(x, y)])
		}
	}
	return p
}

// three items are still named in korean, and every glyph of those comes back
// as a question mark. a card reading "?????" is worse than one reading its id
func readable(s string) bool {
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return true
		}
	}
	return false
}

// basicfont covers printable ascii and nothing else, so anything the client
// spelled with an accent becomes a question mark rather than a blank
func ascii(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= 32 && r < 127 {
			b.WriteRune(r)
		} else {
			b.WriteByte('?')
		}
	}
	return b.String()
}

// derived from the key rather than copied out of lib/categories.mjs, so the
// two cannot disagree. eye-accessory reads as EYE ACCESSORY
func label(key string) string {
	return strings.ToUpper(strings.ReplaceAll(key, "-", " "))
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}
