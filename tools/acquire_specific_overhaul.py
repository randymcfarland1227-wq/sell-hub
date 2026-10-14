"""Acquire overhaul: specific versions only (2026-10-13).

Randy: no vague targets like "textbooks" or "Carhartt jacket". Every
Sourcing Intel row has to name the exact version that sells -- a model
number, an edition, a pressing -- so the Acquire tab works as a reference
for what to grab on a sourcing run.

How the list was built:
- Which versions to name came from eBay search autocomplete
  (autosug.ebaystatic.com), which ranks completions by how often buyers
  search them -- e.g. "carhartt " -> detroit jacket, double knee, j97.
- Books lean toward fashion / beauty coffee-table titles because the two
  books Randy has sold were Kevyn Aucoin's Making Faces and a Louis Vuitton
  fashion book.
- Media exact items come from tools/media_run_specific.py (written 10/1,
  never applied until now).
- Every row was then checked against eBay sold comps; rows with too few
  sales or a low median were dropped before posting (see FILTER below).

Run `python3 tools/acquire_specific_overhaul.py` for the JSON bodies:
deleteSourcingIntel (every row not in KEEP) and upsertSourcingIntel (ADD).
"""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import media_run_specific as media

# Rows that already name one exact item. Their comps history is kept.
KEEP = media.KEEP + [
    'ti-84-plus-ce-graphing-calculator', 'sony-wh-1000xm4-headphones', 'dewalt-20v-battery-charger',
    'stanley-bailey-hand-plane', 'bowflex-selecttech-dumbbells', 'logitech-c920-webcam', 'dymo-labelwriter-450',
    'nintendo-3ds-xl', 'nintendo-ds-lite-console', 'playstation-2-slim-console', 'gamecube-controller',
    'nintendo-64-controller', 'shure-sm58-microphone', 'akai-mpk-mini-midi-controller', 'bosch-laser-measure',
    'dyson-v8-cordless-vacuum', 'nespresso-vertuo-coffee-machine', 'stanley-tumbler', 'starbucks-you-are-here-mug',
    'vintage-star-wars-action-figure', 'hot-wheels-redline', 'ping-eye-2-iron-set', 'timberland-boots',
    'sony-handycam-digital8-camcorder', 'logitech-mx-master-mouse', 'doc-martens-boots', 'lululemon-leggings',
    'elgato-stream-deck', 'blue-yeti-usb-microphone', 'apple-ipod-classic', 'titleist-vokey-wedge',
    'corningware-blue-cornflower', 'fire-king-jadeite', 'champion-hoodie', 'levi-s-501-jeans', 'new-balance-sneakers',
    'ugg-boots', 'canon-ef-50mm-lens', 'raspberry-pi-board', 'apple-tv-streaming-box', 'garmin-etrex-handheld-gps',
    'sony-psp-console', 'game-boy-advance-sp', 'milwaukee-m18-battery', 'cricut-cutting-machine', 'kindle-paperwhite',
    'apple-airpods-pro', 'playstation-5-dualsense-controller', 'sony-walkman-cassette-player',
    'sony-discman-portable-cd-player',
]
# (scotty-cameron-putter, bose-soundlink-speaker and sony-psp-console were
# brand-level; Newport 2, SoundLink Mini and PSP 3000 replace them.)

# Kept rows whose names were looser than their eBay queries -- renamed to the
# exact version the query already pulls, so the card says what to grab.
RENAMES = {
    'stanley-bailey-hand-plane': 'Stanley Bailey No. 4 hand plane',
    'dewalt-20v-battery-charger': 'DeWalt DCB115 20V MAX charger',
    'bowflex-selecttech-dumbbells': 'Bowflex SelectTech 552 dumbbells (pair)',
    'bosch-laser-measure': 'Bosch GLM laser measure',
    'nespresso-vertuo-coffee-machine': 'Nespresso Vertuo coffee machine',
    'stanley-tumbler': 'Stanley Quencher 40 oz tumbler',
    'vintage-star-wars-action-figure': 'Kenner Star Wars figure (1977-85, loose)',
    'timberland-boots': 'Timberland 6-inch Premium boots',
    'doc-martens-boots': 'Dr. Martens 1460 boots',
    'lululemon-leggings': 'Lululemon Align leggings',
    'champion-hoodie': 'Champion Reverse Weave hoodie',
    'new-balance-sneakers': 'New Balance 990 sneakers',
    'ugg-boots': 'UGG Classic boots (women)',
    'canon-ef-50mm-lens': 'Canon EF 50mm f/1.8 lens',
    'raspberry-pi-board': 'Raspberry Pi 4',
    'apple-tv-streaming-box': 'Apple TV 4K',
    'milwaukee-m18-battery': 'Milwaukee M18 REDLITHIUM battery',
    'cricut-cutting-machine': 'Cricut Explore cutting machine',
    'sony-walkman-cassette-player': 'Sony Walkman cassette player (WM series)',
    'sony-discman-portable-cd-player': 'Sony Discman portable CD player (D series)',
    'titleist-vokey-wedge': 'Titleist Vokey SM wedge',
    'fire-king-jadeite': 'Fire-King Jadeite (Jane Ray / restaurant ware)',
    'corningware-blue-cornflower': 'Corning Ware Blue Cornflower casserole',
}

F = dict(cat='Fashion')

def it(term, eb, brand, cat, sub, cost, freq, chk, see, ship='small', test='Low', fake='Low',
       cond='Works untested', know='Beginner', frag='Low', ret='Low', posh='', model=''):
    return dict(term=term, eb=eb, brand=brand, cat=cat, sub=sub, cost=cost, freq=freq, chk=chk, see=see,
                ship=ship, test=test, fake=fake, cond=cond, know=know, frag=frag, ret=ret, posh=posh, model=model)

OUT = ('Fashion', 'Outerwear'); TOP = ('Fashion', 'Shirts'); PANT = ('Fashion', 'Pants')
SHOE = ('Fashion', 'Shoes'); BAG = ('Fashion', 'Bags'); ACC = ('Fashion', 'Accessories')
CAM = ('Electronics', 'Cameras'); AUD = ('Electronics', 'Audio'); WEAR = ('Electronics', 'Wearables')
CON = ('Gaming', 'Consoles'); GAME = ('Gaming', 'Games'); PED = ('Music Gear', 'Pedals'); MG = ('Music Gear', 'Instruments')
TOOL = ('Tools', 'Power tools'); HAND = ('Tools', 'Hand tools'); KIT = ('Home', 'Kitchenware'); APP = ('Home', 'Appliances')
GOLF = ('Sporting Goods', 'Golf'); OUTD = ('Sporting Goods', 'Outdoor'); BOOK = ('Media', 'Books')
THRIFT = 'Thrift store, Bins, Yard sale, Estate sale'

ADD = [
    # ------------------------------------------------------------ Outerwear
    it('Carhartt Detroit Jacket J97', 'carhartt detroit jacket j97 -kids -wip -womens', 'Carhartt', *OUT, (10, 30), 'Occasional',
       ['Tag says J97 or "Detroit"; blanket lining intact', 'Zipper runs the full length', 'Wear and fading are fine -- rips at the cuffs are not'],
       ['Waist-length duck canvas, corduroy collar, blanket-lined', 'Brown (BRN) and black sell best; made-in-USA tags add $20+'], ship='medium', posh='Carhartt Detroit jacket'),
    it('Carhartt Active Jacket J140 (hooded)', 'carhartt active jacket j140 -kids -womens', 'Carhartt', *OUT, (8, 25), 'Common',
       ['J140 / J131 on the tag', 'Hood drawcord and thermal lining intact'],
       ['Hooded duck canvas with quilted lining', 'Faded and worn-in versions still sell'], ship='medium', posh='Carhartt active jacket'),
    it('Carhartt Double Knee pants B01', 'carhartt double knee pants b01 -kids -wip', 'Carhartt', *PANT, (5, 15), 'Common',
       ['Second layer of canvas on the front of each knee', 'Measure the waist -- buyers search by size'],
       ['Brown duck canvas work pants with doubled knees', 'Distressed / painter-splattered pairs still sell'], posh='Carhartt double knee'),
    it('Carhartt Duck Bib Overalls R01', 'carhartt r01 bib overalls -kids -womens', 'Carhartt', *PANT, (8, 25), 'Occasional',
       ['R01 / R02 on the tag, both straps and buckles present', 'Knees and crotch not blown out'],
       ['Brown duck canvas bibs; unlined R01 or quilted R02'], ship='medium', posh='Carhartt bib overalls'),
    it('Patagonia Synchilla Snap-T pullover', 'patagonia synchilla snap-t pullover -kids -baby -vest', 'Patagonia', *OUT, (6, 20), 'Common',
       ['Snap-T placket with 4 snaps, kangaroo pocket', 'Fleece not pilled flat'],
       ['Bright two-tone fleece pullover', 'Older "made in USA" and wild colorways sell highest'], posh='Patagonia Synchilla'),
    it('Patagonia Nano Puff jacket', 'patagonia nano puff jacket -kids -vest -hoody', 'Patagonia', *OUT, (8, 25), 'Occasional',
       ['Brick-quilted pattern, no leaking insulation', 'Zipper and pockets work'],
       ['Thin brick-quilted synthetic puffer'], posh='Patagonia nano puff'),
    it('Patagonia Better Sweater 1/4 zip', 'patagonia better sweater 1/4 zip -kids -vest', 'Patagonia', *TOP, (6, 18), 'Common',
       ['Sweater-knit face, fleece inside', 'Logo patch on the chest'],
       ['Heathered sweater-fleece pullover, common in office donations'], posh='Patagonia better sweater'),
    it('The North Face Nuptse 700 puffer', 'north face nuptse 700 jacket -kids -vest -womens', 'The North Face', *OUT, (10, 30), 'Occasional',
       ['700 fill on the tag; no down leaking or flat baffles', 'Check for fakes: crisp embroidery, hologram tag'],
       ['Boxy shiny puffer with black shoulder yoke', '1996 Retro and vintage versions sell best'], ship='medium', fake='High', cond='Authentication concern', posh='North Face Nuptse'),
    it('The North Face Denali fleece jacket', 'north face denali fleece jacket -kids -womens', 'The North Face', *OUT, (6, 20), 'Common',
       ['Nylon overlays on shoulders and pockets', 'Zipper and pit zips work'],
       ['Heavy fleece with nylon shoulder patches', 'Made-in-USA vintage Denalis bring the most'], ship='medium', posh='North Face Denali'),
    it("Arc'teryx Beta AR jacket", 'arcteryx beta ar jacket -kids -womens -pants', "Arc'teryx", *OUT, (15, 60), 'Rare',
       ['Gore-Tex tag inside, seams taped and not peeling', 'Check the bird logo is embroidered cleanly'],
       ['Shell jacket with the dead-bird logo on the chest'], fake='Medium', cond='Authentication concern', posh="Arc'teryx Beta AR"),
    it('Barbour Beaufort waxed jacket', 'barbour beaufort waxed jacket -dog -womens -kids', 'Barbour', *OUT, (10, 40), 'Rare',
       ['"Beaufort" on the inner tag, tartan lining', 'Game pocket across the back'],
       ['Olive waxed cotton with corduroy collar', 'Crusty, needs-rewax ones still sell'], ship='medium', posh='Barbour Beaufort'),
    it("Levi's Type III trucker jacket (made in USA)", 'levis trucker jacket made in usa vintage 70506 -kids', "Levi's", *OUT, (8, 25), 'Occasional',
       ['Made in USA on the tag (70505/70506 lot numbers)', 'Red tab and all buttons present'],
       ['Pointed-pocket denim jacket'], ship='medium', posh='Levis trucker jacket vintage'),
    it('Filson Mackinaw Cruiser', 'filson mackinaw cruiser wool jacket', 'Filson', *OUT, (15, 60), 'Rare',
       ['Heavy wool, no moth holes; tag says Mackinaw Cruiser', 'All four front pockets intact'],
       ['Thick plaid or solid wool shirt-jacket with four bellows pockets'], ship='medium', posh='Filson Mackinaw'),
    it('Pendleton Board Shirt (wool, vintage)', 'pendleton board shirt wool vintage -kids -shorts', 'Pendleton', *TOP, (5, 15), 'Common',
       ['100% virgin wool tag, no moth holes', 'Loop collar on the Board Shirt'],
       ['Plaid wool shirt with a loop collar; made-in-USA tags'], posh='Pendleton board shirt'),
    it('Vintage Starter NFL pullover jacket', 'vintage starter nfl pullover jacket -kids', 'Starter', *OUT, (8, 25), 'Occasional',
       ['Starter logo on the sleeve, team graphics not cracked', 'Half-zip and kangaroo pocket work'],
       ['90s satin or nylon pullover with big team logo'], ship='medium', posh='Starter jacket vintage'),
    it('Jeff Hamilton NASCAR leather jacket', 'jeff hamilton nascar jacket', 'Jeff Hamilton', *OUT, (15, 60), 'Rare',
       ['Jeff Hamilton tag; leather panels not cracked', 'Patches and embroidery intact'],
       ['Loud racing jacket covered in sponsor patches'], ship='medium', posh='Jeff Hamilton jacket'),
    it('Eddie Bauer goose down jacket (vintage)', 'vintage eddie bauer goose down jacket -kids', 'Eddie Bauer', *OUT, (8, 25), 'Occasional',
       ['Black or brown label with "goose down"', 'No leaking down or torn baffles'],
       ['70s-90s puffer or parka; older labels sell best'], ship='medium', posh='Eddie Bauer goose down vintage'),
    it('Woolrich buffalo plaid wool jacket (vintage)', 'vintage woolrich buffalo plaid wool jacket -kids', 'Woolrich', *OUT, (6, 20), 'Occasional',
       ['Made in USA wool, no moth holes'], ['Red/black buffalo check wool coat'], ship='medium', posh='Woolrich wool jacket vintage'),
    it('90s Nike windbreaker (white tag / grey tag)', 'vintage 90s nike windbreaker jacket -kids', 'Nike', *OUT, (5, 15), 'Common',
       ['White or grey tag with a small swoosh (90s)', 'Zip and lining intact'],
       ['Colorblock nylon shell with big swoosh'], posh='vintage Nike windbreaker'),
    # --------------------------------------------------------------- Tops
    it('Champion Reverse Weave crewneck (vintage USA)', 'vintage champion reverse weave crewneck made in usa -kids', 'Champion', *TOP, (5, 20), 'Occasional',
       ['Side panels running down the ribs (that is Reverse Weave)', 'Made in USA tag = vintage'],
       ['Heavy sweatshirt with C logo on the wrist'], posh='Champion reverse weave vintage'),
    it('Ralph Lauren Polo Bear sweater', 'ralph lauren polo bear sweater -kids -baby', 'Ralph Lauren', *TOP, (8, 40), 'Rare',
       ['Bear knitted into the front (not printed)', 'No holes in the knit'],
       ['Teddy bear in a outfit knitted on the chest'], fake='Medium', posh='Polo bear sweater'),
    it('Polo Ralph Lauren cable knit sweater (men)', 'polo ralph lauren cable knit sweater men -kids -boys', 'Ralph Lauren', *TOP, (5, 15), 'Common',
       ['Cable knit cotton or wool, small pony logo', 'No pilling or holes at elbows'],
       ['Chunky cable sweater, cream and navy sell best'], posh='Polo cable knit sweater'),
    it('Ralph Lauren Purple Label (men)', 'ralph lauren purple label mens -kids', 'Ralph Lauren', *TOP, (5, 30), 'Rare',
       ['Purple label inside the collar, made in Italy', 'Check fabric tag -- cashmere and silk blends are the big ones'],
       ['Plain luxe shirt, sweater or blazer with a purple label'], fake='Medium', posh='Ralph Lauren Purple Label'),
    it('Vintage Harley-Davidson 3D Emblem t-shirt', 'vintage harley davidson 3d emblem t shirt', 'Harley-Davidson', *TOP, (3, 12), 'Occasional',
       ['"3D Emblem" printed on the tag (80s-90s)', 'Single stitch hem adds value'],
       ['Black tee with dealer city on the back'], posh='vintage Harley Davidson 3D emblem'),
    it('Vintage Nirvana t-shirt (90s)', 'vintage nirvana t shirt 90s -reprint', 'Nirvana', *TOP, (3, 20), 'Rare',
       ['Giant / Brockum tag with a 90s copyright date in the print', 'Single-stitch sleeves and hem'],
       ['Smiley face or In Utero art; modern reprints have a 2010s date'], fake='High', cond='Authentication concern', posh='vintage Nirvana shirt'),
    it('Vintage Metallica t-shirt (80s-90s)', 'vintage metallica t shirt -reprint', 'Metallica', *TOP, (3, 20), 'Occasional',
       ['Copyright date in the print, Giant / Brockum / Pushead tag', 'Single stitch'],
       ['Black tee with tour dates on the back'], fake='High', cond='Authentication concern', posh='vintage Metallica shirt'),
    it('Coogi sweater (Australia)', 'coogi sweater made in australia -style -kids', 'Coogi', *TOP, (5, 25), 'Rare',
       ['"Made in Australia" tag; textured 3D knit', 'No snags or holes'],
       ['Loud multicolor textured knit'], posh='Coogi sweater'),
    # --------------------------------------------------------------- Pants
    it("Levi's 505 orange tab (vintage)", 'levis 505 orange tab vintage made in usa', "Levi's", *PANT, (4, 12), 'Occasional',
       ['Orange tab on the back pocket, made-in-USA tag'], ['70s-90s straight leg jeans'], posh='Levis 505 orange tab'),
    it('Lululemon Define jacket', 'lululemon define jacket -kids', 'Lululemon', *TOP, (6, 20), 'Common',
       ['Thumbholes, reflective logo on the back', 'Luon fabric not pilled'],
       ['Fitted zip-up with a curved hem'], posh='lululemon define jacket'),
    it('Lululemon Everywhere belt bag', 'lululemon everywhere belt bag 1l -dupe', 'Lululemon', *BAG, (5, 15), 'Common',
       ['Real zipper pulls with logo; inner tag', 'Strap buckle works'],
       ['Small crossbody fanny pack'], fake='High', cond='Authentication concern', posh='lululemon everywhere belt bag'),
    # --------------------------------------------------------------- Shoes
    it('Nike Dunk Low (men)', 'nike dunk low mens -gs -kids -td -ps', 'Nike', *SHOE, (8, 30), 'Occasional',
       ['Check the inner tag style code matches the box/colorway', 'Toe box and heel not crushed'],
       ['Low-top with a padded collar; Panda black/white is the common one'], fake='High', cond='Authentication concern', posh='Nike Dunk Low'),
    it('Air Jordan 1 Retro High OG', 'air jordan 1 retro high og -gs -kids -td -ps', 'Nike', *SHOE, (10, 40), 'Rare',
       ['Style code on the inner tag; check stitching and wings logo', 'Heel and toe not cracked'],
       ['High-top with the wings logo on the ankle'], fake='High', cond='Authentication concern', posh='Jordan 1 Retro High OG'),
    it('New Balance 9060', 'new balance 9060 -kids -gs', 'New Balance', *SHOE, (8, 30), 'Occasional',
       ['Chunky split sole not separating', 'Size inside the tongue'],
       ['Chunky dad sneaker with a wavy sole'], posh='New Balance 9060'),
    it('Dr. Martens 1460 made in England', 'dr martens 1460 made in england', 'Dr. Martens', *SHOE, (8, 30), 'Rare',
       ['"Made in England" on the heel loop or sole', 'Yellow welt stitching intact'],
       ['8-eye black leather boot; England pairs sell 2-3x Asia-made'], ship='medium', posh='Dr Martens made in England'),
    it('UGG Tasman slippers', 'ugg tasman slippers -kids -toddler', 'UGG', *SHOE, (6, 20), 'Occasional',
       ['Embroidered braid trim around the collar', 'Sheepskin inside not matted flat'],
       ['Low suede slip-on with a braided trim'], fake='High', cond='Authentication concern', posh='UGG Tasman'),
    it('Birkenstock Boston clog (suede)', 'birkenstock boston clog suede -kids', 'Birkenstock', *SHOE, (8, 30), 'Occasional',
       ['Footbed not cracked, sole has tread', 'Size stamped in the footbed (EU)'],
       ['Closed-toe suede clog with one strap'], posh='Birkenstock Boston'),
    it('Hoka Bondi 8', 'hoka bondi 8 -kids', 'Hoka', *SHOE, (6, 20), 'Occasional',
       ['Midsole not compressed flat', 'Size on the tongue'], ['Thick maximal running shoe'], posh='Hoka Bondi 8'),
    it('Brooks Adrenaline GTS 23', 'brooks adrenaline gts 23 -kids', 'Brooks', *SHOE, (5, 18), 'Common',
       ['Tread not worn through, insole present', 'GTS 22/23/24 all sell'],
       ['Everyday support running shoe -- you already sell these well'], posh='Brooks Adrenaline GTS 23'),
    it('Salomon XT-6', 'salomon xt-6 -kids', 'Salomon', *SHOE, (8, 30), 'Rare',
       ['Quicklace system intact', 'Sole not peeling'], ['Trail shoe with a speed-lace toggle'], posh='Salomon XT-6'),
    it('Asics Gel-Kayano 14', 'asics gel kayano 14 -kids', 'Asics', *SHOE, (6, 25), 'Occasional',
       ['"Kayano 14" on the tongue; silver/cream colorways are hot'], ['Y2K-style metallic runner'], posh='Asics Gel Kayano 14'),
    it('Converse Chuck 70 Hi', 'converse chuck 70 high -kids -toddler', 'Converse', *SHOE, (5, 15), 'Common',
       ['Glossy cream midsole and black heel patch = Chuck 70', 'Rubber not separating'],
       ['Heavier canvas than a regular Chuck Taylor'], posh='Converse Chuck 70'),
    it('Red Wing Iron Ranger 8111', 'red wing iron ranger 8111 -kids', 'Red Wing', *SHOE, (10, 40), 'Rare',
       ['Toe cap overlay, made in USA', 'Resoleable welt intact'],
       ['Amber leather lace-up boot with a cap toe'], ship='medium', posh='Red Wing Iron Ranger'),
    it('Red Wing Classic Moc Toe 875', 'red wing moc toe 875 -kids', 'Red Wing', *SHOE, (10, 40), 'Rare',
       ['Moc stitching on the toe, white wedge sole', 'Made in USA'],
       ['Oro-legacy leather work boot with a crepe sole'], ship='medium', posh='Red Wing moc toe'),
    it('Allen Edmonds Park Avenue oxford', 'allen edmonds park avenue -boots', 'Allen Edmonds', *SHOE, (6, 25), 'Occasional',
       ['Cap-toe oxford, model name stamped inside', 'Resoleable; sole wear is OK'],
       ['Black or brown cap-toe dress shoe'], posh='Allen Edmonds Park Avenue'),
    it('Frye Harness boots', 'frye harness boots -kids', 'Frye', *SHOE, (10, 30), 'Occasional',
       ['Harness strap and ring at the ankle', 'Leather not cracked'],
       ['Engineer-style pull-on boot with a ring'], ship='medium', posh='Frye harness boots'),
    it('Sorel Caribou boots', 'sorel caribou boots -kids -liner', 'Sorel', *SHOE, (8, 25), 'Occasional',
       ['Felt liners included', 'Rubber shell not cracked'], ['Tall rubber-and-leather snow boot'], ship='medium', posh='Sorel Caribou'),
    it('L.L.Bean Bean Boots (8 inch)', 'll bean boots 8 inch duck boots -kids -slippers', 'L.L.Bean', *SHOE, (8, 25), 'Occasional',
       ['Rubber bottoms not cracked, made in Maine', 'Size stamped on the heel'],
       ['Leather-upper duck boot with a chain-tread sole'], ship='medium', posh='LL Bean boots'),
    # ---------------------------------------------------------- Bags & acc
    it('Vintage Coach leather bag (made in USA)', 'vintage coach leather bag made in usa -wallet -wristlet', 'Coach', *BAG, (5, 25), 'Occasional',
       ['Creed patch with a serial number and "Made in New York / USA"', 'Leather supple, strap intact'],
       ['Glovetanned leather, brass hardware, no logo print'], fake='Medium', posh='vintage Coach leather bag'),
    it('Coach Tabby shoulder bag', 'coach tabby shoulder bag -wallet -charm', 'Coach', *BAG, (8, 40), 'Rare',
       ['C-logo turnlock hardware, creed inside'], ['Structured flap bag with a chunky C closure'], fake='High', cond='Authentication concern', posh='Coach Tabby'),
    it('Ray-Ban Wayfarer RB2140', 'ray ban wayfarer rb2140 -lenses -case', 'Ray-Ban', *ACC, (3, 15), 'Common',
       ['RB2140 printed inside the arm, etched RB on the left lens', 'Hinges tight'],
       ['Classic trapezoid acetate frame'], fake='High', cond='Authentication concern', posh='Ray-Ban Wayfarer'),
    it('Oakley Holbrook sunglasses', 'oakley holbrook sunglasses -lenses -replacement', 'Oakley', *ACC, (3, 15), 'Common',
       ['Model printed inside the arm, metal O icons on the temples'], ['Squared frame with metal rivets'], fake='Medium', posh='Oakley Holbrook'),
    it('Casio G-Shock DW-5600', 'casio g shock dw5600 -band -bezel', 'Casio', *ACC, (3, 15), 'Common',
       ['Module number on the case back; backlight works'], ['Square digital G-Shock'], test='Medium', cond='Testing recommended'),
    it('Seiko 5 automatic (vintage)', 'vintage seiko 5 automatic watch -parts -band', 'Seiko', *ACC, (5, 25), 'Occasional',
       ['Shake it -- second hand should sweep', 'Day/date wheel turns'],
       ['"Seiko 5" with a shield logo on the dial'], test='Medium', cond='Testing recommended', know='Moderate'),
    it('Yeti Hopper Flip 12 cooler', 'yeti hopper flip 12 -strap', 'Yeti', *OUTD, (8, 30), 'Rare',
       ['Zipper seals and closes', 'No leaks or tears'], ['Soft cube cooler with a flip lid'], ship='medium'),
    it('Starbucks Bearista cup', 'starbucks bearista cup -lid', 'Starbucks', 'Home', 'Drinkware', (2, 10), 'Occasional',
       ['Lid and bear topper present', 'No cracks'], ['Glass or tumbler with a bear-shaped lid'], frag='Medium'),
    # ---------------------------------------------------------- Electronics
    it('Canon PowerShot G7 X Mark II', 'canon g7x mark ii -case -battery -charger', 'Canon', *CAM, (10, 60), 'Rare',
       ['Lens extends and retracts', 'Flip-up screen works'],
       ['Compact black camera with a flip screen -- vlogger favorite'], test='Medium', cond='Testing recommended'),
    it('Canon PowerShot ELPH 360 HS', 'canon powershot elph 360 hs -case -battery', 'Canon', *CAM, (5, 25), 'Occasional',
       ['Battery and charger make it sell faster', 'Lens extends, no error'],
       ['Slim point-and-shoot; Y2K digicam trend keeps these hot'], test='Medium', cond='Testing recommended'),
    it('Sony Cyber-shot RX100', 'sony cyber-shot rx100 -case -battery -grip', 'Sony', *CAM, (10, 60), 'Rare',
       ['Model number (RX100, II-VII) on the top plate', 'Lens extends cleanly'],
       ['Small premium compact with a control ring'], test='Medium', cond='Testing recommended'),
    it('Canon AE-1 Program (body)', 'canon ae-1 program body -lens', 'Canon', *CAM, (10, 40), 'Occasional',
       ['Shutter fires, no "squeak" on the slow speeds', 'Light meter needle moves'],
       ['Silver-and-black 35mm SLR'], test='High', cond='Must test', know='Moderate'),
    it('Olympus Stylus Epic (mju II)', 'olympus stylus epic mju ii 35mm -zoom', 'Olympus', *CAM, (5, 40), 'Rare',
       ['Fixed 35mm f2.8 lens, NOT the zoom version', 'Shutter fires with a battery'],
       ['Tiny clamshell film camera'], test='High', cond='Must test', know='Moderate'),
    it('iPod Nano 7th generation', 'ipod nano 7th generation -case -dock', 'Apple', *AUD, (5, 20), 'Occasional',
       ['Charges and holds a charge', 'Home button works'], ['Tall thin iPod with a touch screen'], test='Medium', cond='Testing recommended'),
    it('Bose SoundLink Mini', 'bose soundlink mini -cover -charger', 'Bose', *AUD, (8, 25), 'Occasional',
       ['Charging cradle included', 'Pairs and plays at volume without buzz'],
       ['Small aluminum bluetooth speaker'], test='Medium', cond='Testing recommended'),
    it('Bose QuietComfort 35 II', 'bose quietcomfort 35 ii -case -cushions -pads', 'Bose', *AUD, (10, 40), 'Occasional',
       ['Noise cancelling turns on; ear pads not flaking'], ['Over-ear headphones with a "QC35 II" on the band'], test='Medium', cond='Testing recommended'),
    it('Bose Wave Music System', 'bose wave music system -remote -parts', 'Bose', *AUD, (10, 30), 'Occasional',
       ['CD tray loads and plays; remote included helps'], ['Rounded tabletop radio/CD player'], ship='large', test='Medium', cond='Testing recommended'),
    it('Garmin Forerunner 245', 'garmin forerunner 245 -band -charger', 'Garmin', *WEAR, (10, 40), 'Rare',
       ['Not locked to an account; charger included', 'Screen not scratched deep'],
       ['Round GPS running watch'], test='Medium', cond='Testing recommended'),
    # -------------------------------------------------------------- Gaming
    it('Game Boy Color console', 'nintendo game boy color console -shell -screen -lot', 'Nintendo', *CON, (10, 40), 'Rare',
       ['Powers on, screen has no dead lines', 'Battery contacts not corroded'],
       ['Translucent or solid-color handheld (CGB-001)'], test='High', cond='Must test'),
    it('Nintendo 64 console', 'nintendo 64 console -controller -parts', 'Nintendo', *CON, (15, 50), 'Rare',
       ['Jumper pak or expansion pak in the top slot', 'Powers on with a game'],
       ['Grey N64; Funtastic colors sell for more'], ship='medium', test='High', cond='Must test'),
    it('Sony PSP 3000', 'sony psp 3000 console -battery -case', 'Sony', *CON, (10, 40), 'Rare',
       ['PSP-3001 on the back; boots to the menu', 'Battery holds charge'], ['Slim handheld with a mic in the top'], test='High', cond='Must test'),
    it('Pokemon HeartGold DS (authentic, complete)', 'pokemon heartgold ds complete authentic -repro -pokewalker', 'Nintendo', *GAME, (5, 40), 'Rare',
       ['Authentic cart: dark grey, NTR code, embossed Nintendo on the back', 'Case and Pokewalker add a lot'],
       ['Gold case with Ho-Oh'], fake='High', cond='Authentication concern', know='Moderate'),
    it('Pokemon Emerald GBA (authentic)', 'pokemon emerald gameboy advance authentic -repro', 'Nintendo', *GAME, (5, 30), 'Rare',
       ['Label has a Nintendo seal and AGB code; board stamped Nintendo', 'Repros are everywhere -- check the screw and board'],
       ['Translucent green cartridge'], fake='High', cond='Authentication concern', know='Moderate'),
    # ---------------------------------------------------------- Music gear
    it('Boss DS-1 Distortion pedal', 'boss ds-1 distortion pedal -power -supply', 'Boss', *PED, (10, 30), 'Occasional',
       ['Made in Japan versions sell higher', 'Plays and switches clean'], ['Orange Boss compact pedal'], test='Medium', cond='Testing recommended'),
    it('Boss DD-3 Digital Delay', 'boss dd-3 digital delay pedal', 'Boss', *PED, (10, 35), 'Occasional',
       ['Delay repeats work in all modes'], ['White Boss compact pedal'], test='Medium', cond='Testing recommended'),
    it('Electro-Harmonix Big Muff Pi', 'electro harmonix big muff pi pedal -nano', 'Electro-Harmonix', *PED, (10, 35), 'Occasional',
       ['Full-size Big Muff (not Nano) holds more value', 'Footswitch works'], ['Silver box with red/black lettering'], test='Medium', cond='Testing recommended'),
    it('Focusrite Scarlett 2i2', 'focusrite scarlett 2i2 -cable', 'Focusrite', *MG, (15, 50), 'Occasional',
       ['Generation printed on the bottom (3rd/4th sell best)', 'Both inputs and phantom power work'],
       ['Red aluminum USB audio interface'], test='Medium', cond='Testing recommended'),
    it('Squier Classic Vibe Stratocaster', 'squier classic vibe stratocaster -neck -body -parts', 'Squier', *MG, (40, 150), 'Rare',
       ['"Classic Vibe" on the headstock', 'Neck straight, electronics work'], ['Vintage-styled Strat with a tinted neck'], ship='large', test='Medium', cond='Testing recommended', know='Moderate'),
    # ---------------------------------------------------------------- Tools
    it('DeWalt DCB205 20V 5.0Ah battery', 'dewalt dcb205 battery 5.0 -charger -adapter', 'DeWalt', *TOOL, (10, 40), 'Occasional',
       ['Charge indicator shows bars', 'Genuine label, not a knock-off'], ['Yellow 20V MAX pack with "5.0Ah"'], test='Medium', fake='Medium', cond='Testing recommended'),
    it('Milwaukee M18 Fuel 1/2 impact wrench 2767-20', 'milwaukee 2767-20 m18 fuel impact wrench -battery -charger', 'Milwaukee', *TOOL, (40, 120), 'Rare',
       ['2767-20 on the label; runs on a battery'], ['Red high-torque impact wrench'], ship='medium', test='Medium', cond='Testing recommended'),
    it('Milwaukee Packout rolling tool box', 'milwaukee packout rolling tool box -insert', 'Milwaukee', *HAND, (20, 60), 'Rare',
       ['Latches and wheels intact, handle extends'], ['Big red-and-black modular box on wheels'], ship='large'),
    it('Stanley Bailey No. 5 jack plane', 'stanley bailey no 5 jack plane -parts', 'Stanley', *HAND, (8, 25), 'Occasional',
       ['Sole not cracked; blade and frog present', 'Older "Sweetheart" blades add value'], ['14 inch metal hand plane'], ship='medium', know='Moderate'),
    # ---------------------------------------------------------------- Home
    it('Le Creuset Dutch oven 5.5 qt round', 'le creuset dutch oven 5.5 qt round -lid -knob', 'Le Creuset', *KIT, (10, 50), 'Rare',
       ['Size number 26 on the lid/bottom = 5.5 qt', 'Enamel inside not chipped through'],
       ['Heavy enameled cast iron pot; Flame orange is the classic'], ship='large', frag='Medium'),
    it('Pyrex Butterprint mixing bowl', 'vintage pyrex butterprint mixing bowl -lid', 'Pyrex', *KIT, (3, 12), 'Occasional',
       ['Pattern not dishwasher-faded', 'No chips on the rim'], ['Turquoise Amish farmer print on white'], ship='medium', frag='High'),
    it('Pyrex Pink Gooseberry', 'pyrex pink gooseberry -lid', 'Pyrex', *KIT, (3, 15), 'Rare',
       ['Bright pink, pattern intact'], ['Pink with white gooseberry vines'], ship='medium', frag='High'),
    it('Griswold No. 8 cast iron skillet', 'griswold no 8 cast iron skillet -lid -dutch', 'Griswold', *KIT, (8, 30), 'Rare',
       ['"Griswold Erie PA" logo on the bottom', 'Sits flat, no cracks'],
       ['Smooth-bottomed old skillet with a cross logo'], ship='medium', know='Moderate'),
    it('KitchenAid Artisan stand mixer', 'kitchenaid artisan stand mixer -attachment -bowl -parts', 'KitchenAid', *APP, (25, 80), 'Rare',
       ['Runs through all speeds without grinding', 'Bowl and beater included'],
       ['Tilt-head mixer; bright colors sell faster'], ship='bulky', test='Medium', cond='Testing recommended'),
    it('KitchenAid pasta roller & cutter set', 'kitchenaid pasta roller cutter attachment set -replacement', 'KitchenAid', *KIT, (5, 25), 'Occasional',
       ['3-piece set: roller, fettuccine, spaghetti cutter'], ['Stainless attachments that plug into the mixer hub']),
    it('Vitamix 5200 blender', 'vitamix 5200 blender -container -lid', 'Vitamix', *APP, (25, 80), 'Rare',
       ['Motor runs, container not cloudy-cracked'], ['Tall black blender with a variable speed dial'], ship='large', test='Medium', cond='Testing recommended'),
    it('Dyson Supersonic hair dryer', 'dyson supersonic hair dryer hd08 -attachment -parts', 'Dyson', *APP, (15, 60), 'Rare',
       ['Serial number on the handle; heat and speed settings work', 'Fakes are common -- check weight and serial'],
       ['Ring-shaped dryer head on a handle'], test='Medium', fake='High', cond='Authentication concern'),
    it('Waterford Lismore wine glasses', 'waterford lismore wine glasses -ornament', 'Waterford', 'Home', 'Glassware', (5, 30), 'Occasional',
       ['Acid-etched Waterford seal on the base', 'No chips on the rims'], ['Cut-crystal stems with a vertical wedge pattern'], ship='medium', frag='High'),
    # ----------------------------------------------------------- Sporting
    it('Scotty Cameron Newport 2 putter', 'scotty cameron newport 2 putter -cover -grip', 'Scotty Cameron', *GOLF, (20, 80), 'Rare',
       ['Model on the sole, shaft band', 'Fakes are common -- check milling and weight'], ['Blade putter'], ship='medium', fake='High', cond='Authentication concern'),
    it('TaylorMade Spider putter', 'taylormade spider putter -cover', 'TaylorMade', *GOLF, (15, 60), 'Occasional',
       ['Model on the sole (Tour, X, EX, GT)'], ['Big mallet putter shaped like a spider'], ship='medium'),
    it('Ping G425 Max driver', 'ping g425 max driver -head -cover', 'Ping', *GOLF, (20, 80), 'Rare',
       ['Shaft and head cover; head not cracked'], ['Black driver with a grey crown'], ship='medium'),
    it('Osprey Daylite Plus backpack', 'osprey daylite plus backpack -kids', 'Osprey', *OUTD, (8, 25), 'Occasional',
       ['All buckles, mesh pockets intact'], ['20L daypack with a front shove-it pocket']),
    it('Osprey Farpoint 40 travel pack', 'osprey farpoint 40 -kids', 'Osprey', *OUTD, (15, 50), 'Rare',
       ['Hideaway harness and zippers work'], ['Carry-on travel pack with a clamshell opening'], ship='medium'),
    it('Rawlings Heart of the Hide glove', 'rawlings heart of the hide glove -youth -kids', 'Rawlings', *OUTD, (10, 40), 'Rare',
       ['"Heart of the Hide" stamp on the palm', 'Laces intact'], ['Pro leather glove'], ship='medium'),
    it('Shimano Stradic spinning reel', 'shimano stradic spinning reel -rod -combo -parts', 'Shimano', *OUTD, (10, 40), 'Rare',
       ['Bail flips, handle turns smooth', 'Model on the side (FL, FK, CI4)'], ['Silver/black spinning reel'], test='Medium', cond='Testing recommended'),
    # ---------------------------------------------------------------- Books
    # Your two book sales were Making Faces and a Louis Vuitton fashion book,
    # so the shelf leans into fashion/beauty coffee-table titles.
    it('Kevyn Aucoin Face Forward', 'kevyn aucoin face forward hardcover', 'Little, Brown', *BOOK, (1, 5), 'Occasional',
       ['Hardcover, jacket intact', 'No water damage'], ['Sequel to Making Faces (which you sold for $24.99)'], ship='Media mail'),
    it('Kevyn Aucoin The Art of Makeup', 'kevyn aucoin the art of makeup hardcover', 'HarperCollins', *BOOK, (1, 5), 'Occasional',
       ['Hardcover 1994'], ['Black cover; his first book'], ship='Media mail'),
    it('Louis Vuitton Catwalk (Thames & Hudson)', 'louis vuitton catwalk book -poster', 'Thames & Hudson', *BOOK, (2, 10), 'Occasional',
       ['Thick hardcover, ~600 pages', 'Corners not crushed'], ['Part of the Catwalk series -- check every one'], ship='Media mail'),
    it('Chanel Catwalk (Thames & Hudson)', 'chanel catwalk book complete collections', 'Thames & Hudson', *BOOK, (2, 10), 'Occasional',
       ['Thick hardcover, not the small paperback'], ['Black cover with Chanel lettering'], ship='Media mail'),
    it('Dior Catwalk (Thames & Hudson)', 'dior catwalk book complete collections', 'Thames & Hudson', *BOOK, (2, 10), 'Occasional',
       ['Thick hardcover'], ['White cover with a model in Dior'], ship='Media mail'),
    it('Prada Catwalk (Thames & Hudson)', 'prada catwalk book complete collections', 'Thames & Hudson', *BOOK, (2, 10), 'Occasional',
       ['Thick hardcover'], ['Same series as Chanel/Dior Catwalk'], ship='Media mail'),
    it('Louis Vuitton: The Birth of Modern Luxury', 'louis vuitton birth of modern luxury abrams', 'Abrams', *BOOK, (2, 10), 'Occasional',
       ['Large hardcover, slipcase adds value'], ['Brown LV monogram cover'], ship='Media mail'),
    it('Tom Ford (Rizzoli 2004)', 'tom ford rizzoli 2004 book -2021 -002', 'Rizzoli', *BOOK, (3, 15), 'Rare',
       ['2004 Rizzoli edition in the silver slipcase', 'Pages not stuck together'],
       ['Silver slipcase, "TOM FORD" in black -- $100+ book'], ship='Media mail'),
    it('Alexander McQueen: Savage Beauty', 'alexander mcqueen savage beauty book', 'Met / Yale', *BOOK, (2, 10), 'Occasional',
       ['Hardcover, the 2011 Met catalog'], ['Black cover with a hologram-style face'], ship='Media mail'),
    it('Vogue: The Covers', 'vogue the covers book dodie kazanjian', 'Abrams', *BOOK, (2, 8), 'Occasional',
       ['Hardcover, jacket on'], ['Grid of Vogue covers on the jacket'], ship='Media mail'),
    it('Slim Aarons: Once Upon a Time', 'slim aarons once upon a time book', 'Abrams', *BOOK, (2, 10), 'Occasional',
       ['Hardcover; Slim Aarons A Place in the Sun / Poolside sell too'], ['Pool-party photo on the cover'], ship='Media mail'),
    it('Gucci: The Making Of (Rizzoli)', 'gucci the making of rizzoli book', 'Rizzoli', *BOOK, (3, 15), 'Rare',
       ['Huge hardcover in a red/green case'], ['Doorstop-sized Gucci history'], ship='Media mail'),
    it('Assouline "In the Spirit of" travel book', 'assouline in the spirit of book -set', 'Assouline', *BOOK, (2, 12), 'Occasional',
       ['Linen-bound hardcover with a tipped-in photo', 'Palm Beach, Hamptons, Aspen titles sell best'],
       ['Square cloth Assouline book, title on a pasted photo'], ship='Media mail'),
    it('Taschen Marvel Comics Library volume', 'taschen marvel comics library -poster', 'Taschen', *BOOK, (5, 30), 'Rare',
       ['XXL size in a clamshell box', 'Numbered edition card inside'],
       ['Giant Taschen box (Spider-Man, Avengers, X-Men)'], ship='large'),
    it('The Art of Walt Disney (Christopher Finch)', 'the art of walt disney christopher finch abrams -mickey', 'Abrams', *BOOK, (2, 10), 'Occasional',
       ['Abrams hardcover; 1973 first edition is the big one', 'Tipped-in plates all present'],
       ['Giant Mickey-and-friends coffee-table book'], ship='Media mail'),
    it('The French Laundry Cookbook (Thomas Keller)', 'french laundry cookbook thomas keller -bouchon', 'Artisan', *BOOK, (2, 8), 'Occasional',
       ['Hardcover with jacket, not food-stained'], ['Big square cookbook with a black cover'], ship='Media mail'),
    it('Martha Stewart Entertaining (1982 first edition)', 'martha stewart entertaining 1982 first edition', 'Clarkson Potter', *BOOK, (1, 5), 'Occasional',
       ['1982 Clarkson Potter, first printing line', 'Jacket intact'], ['Her first book'], ship='Media mail'),
]


def slug(term):
    return re.sub(r'[^a-z0-9]+', '-', term.lower()).strip('-')


def to_intel(r):
    return {
        'opportunityId': slug(r['term']), 'searchTerm': r['term'], 'ebayQuery': r['eb'], 'poshmarkQuery': r['posh'],
        'brand': r['brand'], 'model': r['model'], 'category': r['cat'], 'subcategory': r['sub'],
        'shippingClass': r['ship'], 'testingRisk': r['test'], 'counterfeitRisk': r['fake'],
        'shippingDifficulty': 'Moderate' if r['ship'] in ('large', 'bulky') else 'Easy',
        'fragility': r['frag'], 'returnRisk': r['ret'], 'knowledgeLevel': r['know'],
        'conditionRequirement': r['cond'], 'typicalCostLow': r['cost'][0], 'typicalCostHigh': r['cost'][1],
        'sourcingLocations': THRIFT, 'inspectionNotes': ' | '.join(r['chk']), 'recognitionNotes': ' | '.join(r['see']),
        'platformNotes': 'Specific-version target (2026-10-13 overhaul); eBay sold comps decide the score',
        'active': 'Y', 'thriftFrequency': r['freq'],
    }


# First comps pull returned 0 sales for these: eBay treats every bare word as
# required, so words like "complete", "round", "2003" knocked out real sales.
QUERY_FIXES = {
    'pokemon-heartgold-ds-authentic-complete': 'pokemon heartgold ds -repro -reproduction -pokewalker',
    'le-creuset-dutch-oven-5-5-qt-round': 'le creuset 5.5 qt dutch oven -lid -knob',
    'dyson-supersonic-hair-dryer': 'dyson supersonic hair dryer -attachment -parts -case',
    'where-the-sidewalk-ends-1974-harper-row-first-edition': 'where the sidewalk ends first edition 1974',
    'harry-potter-sorcerer-s-stone-1998-first-american-edition': 'sorcerers stone first american edition',
    'the-poky-little-puppy-little-golden-book-1942-first-edition': 'poky little puppy 1942',
    'sailor-moon-tokyopop-volume-1-2000': 'sailor moon tokyopop volume 1',
    'the-beatles-stereo-box-set-2009-cd': 'beatles stereo box set cd',
    'fullmetal-alchemist-2003-complete-series-dvd-funimation': 'fullmetal alchemist complete series dvd -brotherhood -bluray',
    'criterion-salo-120-days-of-sodom-dvd-spine-17': 'salo criterion dvd',
    'criterion-hard-boiled-dvd-john-woo': 'hard boiled criterion dvd',
    'stephen-king-it-1986-viking-first-edition': 'stephen king it first edition 1986 viking -bce',
    'stephen-king-the-shining-1977-doubleday-first-edition': 'the shining first edition doubleday 1977 -bce',
    'harry-potter-sorcerer-s-stone-1998-first-american-edition': 'sorcerers stone first american edition',
    'blue-note-john-coltrane-blue-train-blp-1577': 'coltrane blue train blue note 1577',
    'john-coltrane-a-love-supreme-impulse-a-77-orange-label': 'a love supreme impulse a-77',
    'julia-child-mastering-the-art-of-french-cooking-1961-first-edition': 'mastering the art of french cooking 1961 first edition -volume',
    'harry-potter-complete-audiobook-cd-set-jim-dale': 'harry potter audiobook cd jim dale complete set',
    'lord-of-the-rings-unabridged-audiobook-cd-rob-inglis': 'lord of the rings audiobook cd rob inglis',
    'evil-dead-book-of-the-dead-dvd-anchor-bay': 'evil dead book of the dead dvd',
    'led-zeppelin-complete-studio-recordings-1993-10-cd-box': 'led zeppelin complete studio recordings 10 cd box -2014',
    'twin-peaks-definitive-gold-box-dvd': 'twin peaks definitive gold box dvd -bluray -mystery',
}


# Tagged "your-sales" (Keywords) for the "Like what you've sold" shelf: same
# kind of item as a past sale or a line that already sells in the shop.
YOUR_SALES = [
    'kevyn-aucoin-making-faces', 'kevyn-aucoin-face-forward', 'kevyn-aucoin-the-art-of-makeup',
    'louis-vuitton-catwalk-thames-hudson', 'chanel-catwalk-thames-hudson', 'dior-catwalk-thames-hudson',
    'prada-catwalk-thames-hudson', 'louis-vuitton-the-birth-of-modern-luxury', 'tom-ford-rizzoli-2004',
    'alexander-mcqueen-savage-beauty', 'vogue-the-covers', 'slim-aarons-once-upon-a-time',
    'gucci-the-making-of-rizzoli', 'assouline-in-the-spirit-of-travel-book', 'the-art-of-walt-disney-christopher-finch',
    'ti-84-plus-ce-graphing-calculator', 'ugg-boots', 'ugg-tasman-slippers', 'brooks-adrenaline-gts-23',
]


# Dropped after the 2026-10-13 comps: too few sales in 90 days or a median
# too low to be worth the shelf space.
DROP = [
    'starbucks-bearista-cup',                          # 5 sold, $20 median
    'cowboy-bebop-remix-complete-dvd-box',             # 1 sold
    'nas-illmatic-1994-columbia-cd-original',          # 5 sold
    'potter-perry-fundamentals-of-nursing-11th-edition',  # $20 median
]


def all_rows():
    rows = [to_intel(r) for r in ADD] + [media.to_intel(r) for r in media.ADD]
    rows = [r for r in rows if r['opportunityId'] not in DROP]
    for r in rows:
        r['ebayQuery'] = QUERY_FIXES.get(r['opportunityId'], r['ebayQuery'])
        if r['opportunityId'] in YOUR_SALES:
            r['keywords'] = 'your-sales'
    ids = [r['opportunityId'] for r in rows]
    dup = {i for i in ids if ids.count(i) > 1}
    assert not dup, dup
    assert not set(ids) & set(KEEP), set(ids) & set(KEEP)
    return rows


if __name__ == '__main__':
    rows = all_rows()
    if '--pairs' in sys.argv:
        json.dump([[r['opportunityId'], r['ebayQuery']] for r in rows], sys.stdout)
    else:
        json.dump({'keep': KEEP, 'rows': rows}, sys.stdout, indent=1)
