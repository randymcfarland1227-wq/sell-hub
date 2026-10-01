"""Media run: exact items only (2026-10-01).

Randy asked for the Media run to name exact items to look for -- a specific
album pressing, a specific edition of a book, a specific DVD release -- not
groupings like "College textbook", "90s hip hop CD" or "Anime DVD box set".

DELETE lists every Media row in Sourcing Intel that is a grouping. KEEP lists
the Media rows that already name one exact item. ADD is the replacement list:
one row per exact item, each with an eBay query tight enough that the sold
comps it pulls are for that item and nothing else.

Typical Cost Low/High are thrift-shelf estimates. Sell prices are not stored
here -- the eBay sold-comps pull fills Market Trends / Market History for each
new Opportunity ID, and that decides the score.

Run `python3 tools/media_run_specific.py` to print the JSON body for the
Apps Script POSTs (deleteSourcingIntel, then upsertSourcingIntel).
"""
import json, re, sys

# Already one exact item each -- left alone.
KEEP = [
    'kevyn-aucoin-making-faces',
    'vintage-betty-crocker-picture-cook-book',
    'saunders-nclex-rn-review-current-edition',
    'tool-lateralus-cd',
    'fleetwood-mac-rumours-lp',
]

# Groupings, removed from Sourcing Intel.
DELETE = [
    # books
    'college-textbook', 'textbook-lot', 'vintage-childrens-picture-book', 'vintage-penguin-paperback',
    'signed-first-edition-book', 'stephen-king-first-edition-hardcover', 'vintage-cookbook', 'cookbook-by-known-chef',
    'manga-volume-lot', 'harry-potter-paperback-lot', 'james-patterson-paperback', 'nora-roberts-paperback-lot',
    'danielle-steel-paperback', 'john-grisham-hardcover', 'self-help-bestseller-paperback',
    'travel-guidebook-recent-edition', 'coffee-table-art-photography-book', 'vintage-national-geographic-book',
    'religious-hardcover-family-bible', 'large-print-mystery-paperback', 'young-adult-dystopian-paperback',
    'vintage-reader-digest-condensed', 'biography-hardcover-celebrity', 'local-history-hardcover-book',
    'taschen-art-book', 'osprey-men-at-arms-military-book-lot',
    # magazines
    'vintage-playboy-magazine-lot', 'national-geographic-magazine-lot', 'sports-illustrated-magazine-lot',
    # CDs
    'classical-or-jazz-cd-box-set', 'sealed-cd', 'rare-cd-single-or-promo', 'classic-rock-cd-lot', '90s-hip-hop-cd',
    'country-music-cd-lot', 'christmas-cd-compilation', 'audiobook-cd-set', 'beatles-cd-remaster', 'jazz-standards-cd',
    'soundtrack-cd-disney-or-film', 'christian-worship-cd', 'complete-cd-binder-lot', 'grateful-dead-dick-s-picks-cd',
    'sealed-or-oop-cd-box-set',
    # DVDs / Blu-ray / VHS
    'criterion-collection-blu-ray', 'complete-series-dvd-box-set', 'anime-dvd-box-set', 'criterion-or-boutique-dvd',
    'disney-dvd', 'horror-dvd-out-of-print', 'marvel-dvd-lot', 'star-wars-dvd-set', 'tv-season-dvd-complete',
    'kids-dvd-lot-disney-pixar', 'workout-fitness-dvd', 'blu-ray-steelbook', 'documentary-dvd-set',
    'holiday-movie-dvd-lot', 'criterion-collection-dvd-or-blu-ray-lot', 'horror-vhs-tape', 'disney-vhs-black-diamond',
    'workout-vhs-tape',
    # vinyl
    'classic-rock-vinyl-lp', 'vinyl-record-box-set', 'motown-vinyl-lp', 'jazz-vinyl-lp-1960s', 'country-vinyl-lp',
    'classical-vinyl-box-set', 'picture-disc-vinyl', '12-inch-dance-single-vinyl', 'sealed-new-vinyl-lp',
    'blue-note-jazz-lp',
]

LOC = 'Thrift store, Estate sale, Library sale, Yard sale'
BOOK = dict(sub='Books', ship='Media mail')
CD = dict(sub='CDs', ship='Media mail')
DVD = dict(sub='DVDs', ship='Media mail')
VHS = dict(sub='VHS', ship='Media mail')
LP = dict(sub='Vinyl', ship='LP mailer')

def item(term, eb, brand, kind, cost, freq, chk, see, model=''):
    return dict(term=term, eb=eb, brand=brand, model=model, cost=cost, freq=freq, chk=chk, see=see, **kind)

ADD = [
    # ---------------------------------------------------------------- Books
    item('Campbell Biology 12th edition hardcover', 'campbell biology 12th edition hardcover -loose -looseleaf -mastering -study',
         'Pearson', BOOK, (1, 4), 'Common',
         ['12th edition (2020), ISBN 9780135188743, printed on the cover', 'Hardcover, not the loose-leaf binder version', 'Highlighting is OK if light; no water damage'],
         ['Huge green-and-blue hardcover, Urry/Cain/Wasserman on the cover', 'Older editions (10th, 11th) are worth very little -- check the number']),
    item('Potter & Perry Fundamentals of Nursing 11th edition', 'potter perry fundamentals of nursing 11th edition -study -guide -test',
         'Elsevier', BOOK, (1, 4), 'Occasional',
         ['11th edition (2022) on the spine', 'Not the study guide or clinical companion', 'Spine not split'],
         ['Thick red/white Elsevier hardcover', 'Nursing textbooks one edition back still sell; two back do not']),
    item('Bates Guide to Physical Examination 13th edition', 'bates guide to physical examination 13th edition -pocket -study',
         'Wolters Kluwer', BOOK, (1, 4), 'Occasional',
         ['13th edition (2020) -- the "Pocket Guide" is a different, cheaper book', 'Cover and spine intact'],
         ['Big hardcover, Bickley on the cover', 'Shows up after nursing and PA students graduate']),
    item('Stephen King It 1986 Viking first edition', 'stephen king it 1986 viking first edition hardcover -bce -book club -paperback',
         'Viking', BOOK, (1, 5), 'Occasional',
         ['Copyright page says "First published in 1986 by Viking"', '$22.95 price on the jacket flap, not clipped', 'No "Book Club Edition" on the flap and no blind-stamp dot on the back board'],
         ['Thick hardcover, green paper-boat jacket art', 'Book club copies are smaller and thinner -- pass on those']),
    item('Stephen King The Shining 1977 Doubleday first edition', 'stephen king the shining 1977 doubleday first edition -bce -book club -paperback',
         'Doubleday', BOOK, (2, 10), 'Rare',
         ['Gutter code "R49" printed near the spine on page 447 = true first', 'Jacket price $8.95, unclipped', 'No "Book Club Edition" anywhere'],
         ['Book club copies are common and worth little; the R49 code is what makes it real', 'Black jacket with a boy\'s face, silver/gold lettering']),
    item("Harry Potter Sorcerer's Stone 1998 first American edition", "harry potter sorcerer's stone first american edition 1998 scholastic hardcover 1st printing -book club",
         'Scholastic', BOOK, (1, 5), 'Rare',
         ['Copyright page number line runs "10 9 8 7 6 5 4 3 2 1" (lowest number = printing)', '"First American edition, October 1998"', 'Jacket price $16.95'],
         ['Later printings are worth $10-15; a 1st printing is worth hundreds', 'Check every Sorcerer\'s Stone hardcover -- it takes five seconds']),
    item('Where the Sidewalk Ends 1974 Harper & Row first edition', 'where the sidewalk ends 1974 first edition harper row hardcover -30th -anniversary',
         'Harper & Row', BOOK, (1, 4), 'Occasional',
         ['Copyright page: 1974, Harper & Row, no later dates', 'Jacket price $6.95 or similar, no barcode on the back', 'No crayon or torn poems'],
         ['White cover with the boy at the edge of the sidewalk', 'Later printings have a barcode and HarperCollins -- those are $5 books']),
    item('The Poky Little Puppy Little Golden Book 1942 first edition', 'poky little puppy little golden book 1942 first edition 8 -reprint',
         'Little Golden Books', BOOK, (0.5, 3), 'Rare',
         ['Book number 8 on the cover and a blue paper spine', 'Has a dust jacket (1942 firsts had jackets) or price 25c', 'All pages present, no scribbles'],
         ['Golden-foil spine Little Golden Books are later printings', 'Early printings carry a letter code on the last page -- "A" = first']),
    item('Julia Child Mastering the Art of French Cooking 1961 first edition', 'mastering the art of french cooking 1961 first edition knopf -volume two -1970',
         'Knopf', BOOK, (2, 10), 'Rare',
         ['Copyright page shows 1961 and no later printing line', 'Jacket price $10.00, unclipped', 'Text block not grease-stained'],
         ['Cream cloth with a fleur-de-lis pattern', 'Later printings are common and sell for $15-25 -- only the first is the find']),
    item('The Book of Symbols Taschen ARAS 2010', 'book of symbols reflections on archetypal images taschen -mini',
         'Taschen', BOOK, (2, 8), 'Occasional',
         ['Full-size hardcover (about 800 pages), not a mini edition', 'Pages not stuck or water-rippled'],
         ['Black cover, gold symbol on the front', 'Steady $40-60 seller; thrift prices it like any coffee-table book']),
    item('Sailor Moon Tokyopop volume 1 (2000)', 'sailor moon tokyopop volume 1 2000 manga -kodansha -lot',
         'Tokyopop', BOOK, (0.5, 3), 'Occasional',
         ['Tokyopop logo, not Kodansha (Kodansha is the common 2011 reprint)', 'Spine not faded or cracked'],
         ['Small pink-spined paperback', 'Out-of-print Tokyopop volumes sell singly; vol 1 and the late volumes do best']),
    # ---------------------------------------------------------------- CDs
    item('Dr. Dre The Chronic 1992 Death Row CD original', 'dr dre the chronic cd 1992 death row interscope original -sealed -remaster -2001',
         'Death Row', CD, (0.5, 3), 'Occasional',
         ['Death Row / Interscope logos on the back insert (the 2001 reissue says "Death Row" only and has a different tray)', 'Disc not scratched across the tracks'],
         ['Zig-Zag-style cover', '1992 originals sell well above later reissues']),
    item('Nas Illmatic 1994 Columbia CD original', 'nas illmatic cd 1994 columbia original -xx -anniversary -vinyl',
         'Columbia', CD, (0.5, 3), 'Occasional',
         ['Catalog CK 57684 on the spine', 'Not the "XX" 20th-anniversary edition'],
         ['Black-and-white photo of young Nas over a project', 'Original-pressing booklets and discs carry the value']),
    item('Wu-Tang Clan Enter the Wu-Tang 36 Chambers 1993 CD', 'wu-tang clan enter the wu-tang 36 chambers cd 1993 loud rca -vinyl',
         'Loud / RCA', CD, (0.5, 3), 'Occasional',
         ['Loud / RCA, catalog 07863 66336-2', 'Booklet present'],
         ['Black cover, masked members', 'Original Loud pressings sell steadily']),
    item('The Beatles Stereo Box Set 2009 CD', 'beatles stereo box set 2009 cd 16 disc -mono -dvd only',
         'Apple / EMI', CD, (5, 25), 'Rare',
         ['16 discs plus the DVD -- count them', 'Box not crushed, booklet present', 'Not the Mono box (different, see that row)'],
         ['Black long box, apple logo', 'Estate sales and Marketplace more than thrift shelves']),
    item('The Beatles in Mono Box Set 2009 CD', 'beatles in mono box set 2009 cd -stereo -vinyl',
         'Apple / EMI', CD, (5, 25), 'Rare',
         ['13 discs in mini LP sleeves', 'Booklet present'],
         ['White/grey box, "THE BEATLES IN MONO"', 'Worth more than the stereo box']),
    item('Led Zeppelin Complete Studio Recordings 1993 10-CD box', 'led zeppelin complete studio recordings 10 cd box 1993 -remaster 2014',
         'Atlantic', CD, (3, 15), 'Rare',
         ['10 discs, each in its own mini sleeve', 'Booklet present, box not split'],
         ['Black box with the zeppelin-shadow photo', '1993 Atlantic box, not the 2014 Jimmy Page remaster sets']),
    item('Pink Floyd Dark Side of the Moon MFSL gold CD UDCD 517', 'pink floyd dark side of the moon mfsl gold cd udcd 517',
         'Mobile Fidelity', CD, (1, 5), 'Rare',
         ['Gold disc, "Original Master Recording" banner', 'UDCD 517 on the spine', 'Long box or jewel case both sell'],
         ['Any gold MFSL CD is worth a look; this one is the most common big seller']),
    item('Johnny Cash Unearthed 2003 5-CD box', 'johnny cash unearthed 5 cd box set 2003 american recordings -vinyl',
         'American Recordings', CD, (2, 10), 'Rare',
         ['5 discs including "Best of Cash on American"', 'Hardbound book present'],
         ['Black box, Cash on the cover in a dark coat']),
    item('Miles Davis & John Coltrane Complete Columbia Recordings 1955-1961', 'miles davis john coltrane complete columbia recordings 1955-1961 6 cd metal',
         'Columbia / Legacy', CD, (2, 10), 'Rare',
         ['Metal-spine box, 6 discs', 'Booklet present'],
         ['Silver ridged spine looks like a hinge', 'Columbia/Legacy box sets of this series all sell; this is the top one']),
    item('Bill Evans Complete Riverside Recordings 12-CD box', 'bill evans complete riverside recordings 12 cd box',
         'Riverside', CD, (3, 15), 'Rare',
         ['12 discs', 'Booklet present'],
         ['Black box, Riverside reel-to-reel logo', 'Estate-sale find with a jazz collection']),
    item('Harry Potter complete audiobook CD set Jim Dale', 'harry potter complete audiobook cd set jim dale listening library 1-7 unabridged',
         'Listening Library', CD, (5, 25), 'Rare',
         ['All seven books, every disc present -- count against each box', '"Read by Jim Dale" (US). Stephen Fry is the UK version and also sells'],
         ['Big stack of chunky boxes, Listening Library logo', 'Single books sell too, but the full set is the money']),
    item('Lord of the Rings unabridged audiobook CD Rob Inglis', 'lord of the rings unabridged audiobook cd rob inglis recorded books -bbc',
         'Recorded Books', CD, (3, 15), 'Rare',
         ['Read by Rob Inglis, unabridged (the BBC radio drama is a different, cheaper set)', 'Every disc present'],
         ['Recorded Books clamshell cases, often ex-library']),
    # ---------------------------------------------------------------- DVDs and VHS
    item('Neon Genesis Evangelion Platinum Complete DVD', 'neon genesis evangelion platinum complete collection dvd adv -bluray -bootleg',
         'ADV Films', DVD, (2, 10), 'Rare',
         ['ADV Films logo, 7 discs', 'Bootleg check: blurry print, Chinese text on the back, no ADV logo'],
         ['Silver/purple box, Unit-01 on the cover', 'Out of print; US ADV sets are the real ones']),
    item('Cowboy Bebop Remix complete DVD box', 'cowboy bebop remix complete dvd box bandai -bluray -bootleg',
         'Bandai', DVD, (2, 10), 'Rare',
         ['Bandai Entertainment logo, 6 discs', 'Bootleg check as with Evangelion'],
         ['Black art box with Spike', 'The Remix release, not the single-disc "Session" volumes']),
    item('Fullmetal Alchemist 2003 complete series DVD Funimation', 'fullmetal alchemist complete series dvd funimation 2003 -brotherhood -bluray',
         'Funimation', DVD, (2, 8), 'Occasional',
         ['The 2003 series, NOT Brotherhood (more common, cheaper)', 'All discs present'],
         ['Funimation box, Ed in the red coat']),
    item('Twin Peaks Definitive Gold Box DVD', 'twin peaks definitive gold box edition dvd -bluray -entire mystery',
         'CBS / Paramount', DVD, (2, 8), 'Occasional',
         ['10 discs, gold box', 'Not "The Entire Mystery" Blu-ray (separate row if ever added)'],
         ['Gold box with the red-curtain room']),
    item('Freaks and Geeks complete series DVD yearbook edition', 'freaks and geeks complete series dvd yearbook edition shout -bluray',
         'Shout! Factory', DVD, (2, 8), 'Occasional',
         ['Yearbook edition: hardbound yearbook-style case, 8 discs', 'Yearbook pages not torn'],
         ['Looks like a high-school yearbook on the shelf']),
    item('Walt Disney Treasures On the Front Lines DVD tin', 'walt disney treasures on the front lines dvd tin',
         'Walt Disney Treasures', DVD, (1, 5), 'Rare',
         ['Metal tin with the numbered certificate', 'Both discs present'],
         ['WWII-era Disney shorts, out of print since 2004', 'Any "Walt Disney Treasures" tin is worth checking; this one is the top seller']),
    item('Criterion Salo 120 Days of Sodom DVD spine 17', 'criterion salo 120 days of sodom dvd spine 17 -bluray -2011',
         'Criterion', DVD, (1, 5), 'Rare',
         ['Spine #17 (1998 release) -- the 2011 re-release is common and cheap', 'Disc unscratched'],
         ['Black Criterion case, spine 17']),
    item('Criterion Hard Boiled DVD (John Woo)', 'criterion hard boiled dvd john woo -dragon dynasty -bluray',
         'Criterion', DVD, (1, 5), 'Rare',
         ['Criterion logo (the later Dragon Dynasty release is worth little)'],
         ['Out-of-print Criterion, Chow Yun-fat with two guns']),
    item('Evil Dead Book of the Dead DVD Anchor Bay', 'evil dead book of the dead dvd anchor bay latex',
         'Anchor Bay', DVD, (1, 5), 'Rare',
         ['Latex "skin" cover with the face, not torn or sticky', 'Disc and insert present'],
         ['Looks like a rubber book on the shelf']),
    item('Star Wars Trilogy 2006 Limited Edition DVD', 'star wars trilogy 2006 limited edition dvd theatrical -2004 -bluray',
         'Lucasfilm', DVD, (1, 5), 'Occasional',
         ['2006 Limited Edition = each film has a bonus disc with the original theatrical cut', 'Three cases, not the 2004 four-disc box'],
         ['Each film sold separately in a gold-trimmed slipcover, or as a 3-pack']),
    item('P90X original DVD set (13 discs)', 'p90x dvd set 13 disc beachbody complete -p90x2 -p90x3',
         'Beachbody', DVD, (1, 5), 'Occasional',
         ['All 13 workout discs plus the fitness guide', 'Not P90X2 or P90X3'],
         ['Black case with a ridged wrap']),
    item('Insanity complete DVD set Beachbody', 'insanity shaun t dvd set complete beachbody -max -asylum',
         'Beachbody', DVD, (1, 5), 'Occasional',
         ['10 discs plus calendar and nutrition guide', 'Not Insanity Max:30 or Asylum'],
         ['Red-and-black box, Shaun T on the front']),
    item('Sleepaway Camp VHS Media Home Entertainment', 'sleepaway camp vhs media home entertainment 1984 -dvd -bluray',
         'Media Home Entertainment', VHS, (0.5, 3), 'Rare',
         ['Media Home Entertainment logo (original 1984 release)', 'Tape spools clean, cover not faded'],
         ['Camper with a knife on the cover', '80s horror on original rental labels is what collectors chase']),
    # ---------------------------------------------------------------- Vinyl
    item('Pink Floyd Dark Side of the Moon 1973 Harvest SMAS-11163', 'pink floyd dark side of the moon smas-11163 harvest 1973 -2016 -reissue',
         'Harvest', LP, (3, 15), 'Occasional',
         ['SMAS-11163 on the spine and label; solid blue triangle Harvest label', 'Both posters and both stickers add a lot', 'Play-grade under light'],
         ['Black cover with the prism', 'Later reissues and 180g repressings sell for less']),
    item('Led Zeppelin IV 1971 Atlantic SD 7208', 'led zeppelin iv atlantic sd 7208 1971 -reissue -180',
         'Atlantic', LP, (3, 12), 'Occasional',
         ['SD 7208 on the label and spine', 'Inner sleeve with lyrics present', 'Gatefold seams intact'],
         ['Old man with sticks on the cover, no title', 'Original Atlantic labels: red/maroon and plum']),
    item("Marvin Gaye What's Going On 1971 Tamla TS 310", "marvin gaye what's going on tamla ts 310 1971 -reissue",
         'Tamla', LP, (2, 10), 'Occasional',
         ['Tamla label, TS 310', 'Gatefold'],
         ['Marvin in the rain with a beard', 'Motown family labels (Tamla, Gordy, Motown) from 60s-70s all worth pulling']),
    item('John Coltrane A Love Supreme Impulse A-77 orange label', 'john coltrane a love supreme impulse a-77 orange black label -reissue -180',
         'Impulse!', LP, (3, 15), 'Rare',
         ['Impulse A-77 (mono) or AS-77 (stereo)', 'Orange/black label = 60s pressing', 'Gatefold'],
         ['Black-and-white Coltrane portrait', 'Red/black and later labels are reissues worth much less']),
    item('Miles Davis Kind of Blue Columbia CL 1355 six-eye', 'miles davis kind of blue columbia cl 1355 six eye -reissue -180',
         'Columbia', LP, (3, 15), 'Rare',
         ['"CL 1355" (mono) or "CS 8163" (stereo) on the label', 'Six white "eye" logos around the label = 1959-62 pressing'],
         ['Green-tinted photo of Miles playing', 'Two-eye and later labels are common']),
    item('Johnny Cash At Folsom Prison 1968 Columbia CS 9639', 'johnny cash at folsom prison columbia cs 9639 1968 -reissue',
         'Columbia', LP, (1, 6), 'Occasional',
         ['CS 9639, red "360 Sound" label', 'Back cover liner notes intact'],
         ['Cash in a dark suit on the cover', 'Country\'s most commonly found good seller']),
    item('Blue Note John Coltrane Blue Train BLP 1577', 'john coltrane blue train blue note 1577 -reissue -tone poet -classic',
         'Blue Note', LP, (3, 20), 'Rare',
         ['BLP 1577 (mono) or BST 81577', 'Label shows "47 West 63rd" or "New York, USA" -- "Liberty" or "A Division of United Artists" are later'],
         ['Blue-tinted Coltrane photo', 'Replaces the old "Blue Note jazz LP" grouping -- this is the title to look for']),
]

def slug(term):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', term.lower())).strip('-')

def to_intel(r):
    return {
        'opportunityId': slug(r['term']),
        'searchTerm': r['term'],
        'ebayQuery': r['eb'],
        'poshmarkQuery': '',
        'brand': r['brand'],
        'model': r['model'],
        'category': 'Media',
        'subcategory': r['sub'],
        'shippingClass': r['ship'],
        'testingRisk': 'Low',
        'counterfeitRisk': 'Medium' if r['sub'] == 'DVDs' and 'bootleg' in ' '.join(r['chk']).lower() else 'Low',
        'shippingDifficulty': 'Easy',
        'fragility': 'High' if r['sub'] == 'Vinyl' else 'Low',
        'returnRisk': 'Low',
        'knowledgeLevel': 'Moderate',
        'conditionRequirement': 'Works untested',
        'typicalCostLow': r['cost'][0],
        'typicalCostHigh': r['cost'][1],
        'sourcingLocations': LOC,
        'inspectionNotes': ' | '.join(r['chk']),
        'recognitionNotes': ' | '.join(r['see']),
        'platformNotes': 'eBay sold comps decide the score',
        'active': 'Y',
        'thriftFrequency': r['freq'],
    }

def payload():
    rows = [to_intel(r) for r in ADD]
    ids = [r['opportunityId'] for r in rows]
    assert len(ids) == len(set(ids)), 'duplicate opportunity IDs'
    assert not set(ids) & set(DELETE), 'a new ID collides with a deleted one'
    assert not set(KEEP) & set(DELETE)
    return {'delete': {'action': 'deleteSourcingIntel', 'ids': DELETE},
            'upsert': {'action': 'upsertSourcingIntel', 'rows': rows}}

if __name__ == '__main__':
    p = payload()
    if '--summary' in sys.argv:
        print(f"delete {len(p['delete']['ids'])}, keep {len(KEEP)}, add {len(p['upsert']['rows'])}")
        for r in p['upsert']['rows']:
            print(f"  {r['subcategory']:6} {r['searchTerm']}  [{r['ebayQuery']}]")
    else:
        json.dump(p, sys.stdout, indent=1)
