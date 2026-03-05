# Chapter 4: Year 1145 — The Great Loss

## Summary

Dire Dan rises — a self-proclaimed prophet who claims God visited him and commanded scourging. His followers (Direites) number in the tens of thousands. They hunt in packs of 10–30, torture prisoners, kill people daily as morning ritual. "If you do not join, they would keep you prisoner for days." Violence spreads across both sides of the library.

Soren and Rachel flee. Cornered. Rachel says "I love you," climbs the railing, and jumps into the chasm. Soren is captured. Killed repeatedly (37 days, 6 seconds of consciousness each time). Learns to think in fragments. Escapes, tackles Dire Dan over the railing. They fall together.

Freefall: Dire Dan practices skydiving, attacks Soren mid-air. They separate. Soren learns to control his fall — spread-eagle to slow down, arms tucked to dive, smock-as-wing for directional control. Falls for days, dies of thirst, revives, keeps falling. Eventually crashes back into the stacks through brutal trial and error (broken legs, arms, back, neck across multiple attempts).

Meets a man far below who's been searching for the bottom. The man has a book with two grammatically correct sentences: "Breath, comes to me in bursts of joy. Stones retched out bloody worms, worn red with the passing of licking patterns of salt." Soren weeps at the beauty.

Climbs back up for weeks. Thinks of nature — birds, cockroaches, wind through leaves — everything absent from Hell. "What I would have given even to see a cockroach in this place."

## Key Prose & Imagery

> Rachel's last moment: "She seemed surprisingly calm. 'I love you,' she said, a beautiful smile on her face."

> "I watched her fall. She did not scream, she just fell downward, down, down, and down."

> "'I love you too,' I said to the empty air below me."

> Freefall combat: "His look was one of pure and absolute hatred. He maneuvered a little closer and started screaming at me what appeared to be a well-rehearsed speech."

> Dying of thirst in freefall: "At one point I thought Rachel was falling beside me carrying a large pitcher of orange juice, which she was trying to pass to me, but every time I reached for it she would drift out of reach."

> The coherent sentences: "I'd never read anything of such profound clarity in the library before. Tears rolled down my face."

> Nature passage: "What I would have given even to see a cockroach in this place. It would be heralded as a treasure that could not be purchased with a king's ransom. Songs would be written about its delicate multi-segmented antennae."

> "The clomping of my feet climbing up the steps reminded me of the poverty of sensation we endured here."

> On the man with the book: "He was carrying a pillowcase with a book in it. He sat it carefully beside him."

## Dire Dan's God Speech

> "You will be like a whip in my hand. You will be the sword in my clenched fist. You will bring them to punishment ... Kill them again and again. Rape them, torture them, cause them pain and fire. Leave not a moment of peace."

## Implementable Details

- **Violence/gangs**: the Direites. We probably won't implement full combat, but NPC disposition deterioration (mad NPCs) reflects this. Mad NPCs could reference violence, "God's work," scourging.
- **The chasm jump**: Rachel's jump is the central loss. Our chasm/jump system (issue #56, despairing changes jump behavior) directly mirrors this. The chasm is escape, death, and loss.
- **Freefall physics**: spread-eagle to slow, tucked to dive, smock-as-wing for direction. The chasm design doc should reference this. If we implement the freefall system, these mechanics are canon.
- **Crashing back into stacks**: brutally physical. Broken limbs, multiple attempts across days. Each death = reset, try again tomorrow.
- **Dying of thirst in freefall**: kiosk is on the shelves. Falling means no food/water. Thirst kills in ~3 days. Our survival stats apply during freefall.
- **Coherent text as emotional event**: two grammatical sentences reduce a grown man to tears after 1000+ years. Our sensibility/fragment system should feel like this.
- **Nature absence**: the "poverty of sensation." Hell has no nature, no animals, no weather, no variety. Events should emphasize what's *missing*, not just what's present.
- **Pillowcase as bag**: people improvise carrying solutions. The kiosk gives food but no containers — you make do.
- **Morning killing ritual**: Direites kill prisoners every morning as routine. "They stepped and maneuvered around the many bodies like it was a normal morning." Banality of violence.
- **"Would you like me to kill you?"**: mercy killing is normal. The kind man asks it like offering coffee.
