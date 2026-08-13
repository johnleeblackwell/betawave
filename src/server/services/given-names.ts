/**
 * First-name gender inference.
 *
 * WHY A LIST AND NOT AN API
 *
 * LinkedIn's connections export carries no gender field, so building a
 * women-only list from it means inferring from the given name. The paid APIs
 * that do this charge per lookup and would cost real money for a list of a few
 * thousand — for a signal that a human is about to check by eye anyway.
 *
 * ACCURACY POSTURE: deliberately biased toward RECALL, not precision.
 *
 * The output feeds a queue that a person scans profile-by-profile, deciding to
 * draft or to reject. A false positive costs one glance. A false negative means
 * someone never appears at all and is never seen again. So ambiguous names are
 * INCLUDED, and only names that are strongly male are excluded.
 *
 * This is a heuristic on a cultural convention, not a fact about anybody. It
 * decides queue order and nothing else; the human decides who is actually
 * contacted, and anyone mis-sorted is simply skipped.
 */

/** Common feminine given names across the target markets (US, CA, UK, AU, NZ, PL). */
const FEMALE = new Set<string>(`
abigail ada adaeze adele adriana agata agnes agnieszka aileen aimee aisha aisling
alana albertina alessandra alex alexa alexandra alexis alice alicia alina alison
allison alma alyssa amanda amber amelia amina amy ana anastasia andrea aneta angela
angelica anita ann anna annabel anne annette annie antonia anya april arielle
ashley astrid aurora ava barbara beata beatrice becky belinda bernadette beth
bethany betty beverly bianca blanca bogumila bonnie brenda bridget brigitte britney
brittany brooke camilla candice cara caroline carla carmen carol carolina caroline
carrie casey cassandra catherine cathy cecilia celeste celia charlene charlotte
chelsea cheryl chiara chloe christina christine cindy claire clara claudia colleen
connie constance cora courtney crystal cynthia daisy dana daniela danielle daphne
darlene dawn deborah debra deirdre delia denise diana diane dominika donna dora
doreen doris dorota dorothy ebony edith edyta eileen elaine eleanor elena eliza
elizabeth ella ellen elsie elvira emilia emily emma erica erin esther ethel eva
evelyn ewa faith farah fatima fay felicity fiona florence frances francesca freya
gabriela gail gemma georgia georgina geraldine gillian gina giulia gloria grace
gracie greta gwen hailey halina hannah harriet hayley hazel heather heidi helen
helena henrietta hilary hilda holly honor hope iga ilona imogen ines inga ingrid
irene iris isabel isabella isla ivy izabela jacinta jackie jacqueline jade jamie
jan jane janet janice jasmine jayne jean jeanette jenna jennifer jenny jessica
jill joan joanna joanne jocelyn jodie joelle johanna jolanta jordan josephine joy
joyce judith judy julia julie juliet justyna kaitlyn karen karin karina karolina
kasia kate katarzyna katherine kathleen kathryn kathy katie katrina kay kayla
kelly kelsey kendra kerry khadija kim kimberly kirsten kirsty klaudia krystyna
kylie lara laura lauren laurie leah leanne lena leonie lesley leslie lidia lila
lilian lily linda lindsay lisa liz lois lorna lorraine louise lucia lucy luisa
lydia lynn mabel madeleine madison maggie magdalena maja malgorzata mandy mara
marcia margaret maria mariam marianne marie marilyn marina marion marisa marta
martha martina mary maura maureen mavis maya megan melanie melissa mercy meredith
mia michaela michelle mila mildred millie miranda miriam moira molly monica monika
morgan nadia nancy naomi natalia natalie natasha nell nicola nicole nina noelle
nora norah nuala oksana olga olivia paige pamela patricia patrycja paula paulina
pauline pearl penelope penny petra philippa phoebe phyllis pippa polly priya
rachel rachael rebecca regina rene renee rhoda rhonda rita roberta robin robyn
rochelle romana rosa rosalind rose rosemary rowena roxanne ruth sabina sabrina
sadie sally salma samantha sandra sara sarah sasha saskia scarlett selina serena
shannon sharon sheila shelley sheryl shirley sian sienna silvia simone sinead
sofia sonia sophia sophie stacey stefania stella stephanie sue summer susan
susanna suzanne sybil sylvia tamara tammy tania tanya tara tasha teresa tess
tessa thea thelma theresa tiffany tina toni tracey tracy trudy ursula valentina
valerie vanessa vera veronica vicki victoria violet virginia vivian wanda wendy
whitney wilma winifred yasmin yolanda yvette yvonne zara zoe zofia zuzanna
`.trim().split(/\s+/))

/** Names that are strongly male and would otherwise be caught by the -a rule. */
const MALE = new Set<string>(`
aleksandra_no akiva andrea_it aron attila barnaba bartosz benicio bogdan borja
cosma dana_ro elisha ezra federica_no garcia hamza hasan ilia iva_no joshua
jonah juma kuba luca luka mateusz mika mikhail mustafa nikola nikita noah obadiah
ola_no pasha rafa sacha sasha_m shea sinan sasa tadeusz tomasz uzoma yaakov
zachariah zeljko andrea_male joshua_male
`.trim().split(/\s+/))

/** Clearly masculine names, used to veto the trailing-a heuristic. */
const MALE_COMMON = new Set<string>(`
aaron adam adrian alan albert alex_m alexander alfred andrew andy angus anthony
antoine arthur ashley_m barry ben benjamin bernard bill bob brad bradley brendan
brian bruce bryan callum calvin cameron carl charles chris christian christopher
clive colin conor craig curtis dale damian daniel darren dave david dean declan
dennis derek dominic donald douglas duncan dylan edward eliot elliot eric ernest
eugene evan frank fraser fred frederick gareth gary gavin geoffrey george gerald
gerard glen gordon graham grant greg gregory harold harry harvey henry howard
hugh iain ian isaac ivan jack jacob jake james jamie_m jason jeff jeffrey jeremy
jerome jerry jim joe john jonathan jordan_m joseph josh joshua julian justin keith
ken kenneth kevin kieran kyle lance larry lawrence lee leon leonard lewis liam
lionel lloyd logan louis lucas luke malcolm marc marcin marcus mark martin mason
matthew maurice max michael mike miles mitchell nathan neil nicholas nigel noel
norman oliver oscar owen patrick paul pawel peter philip phillip piotr quentin
ralph randy raymond reece reuben richard rick robert roderick rodney roger roland
ronald rory ross roy russell ryan sam_m samuel scott sean sebastian sergio seth
shane shaun shawn sidney simon spencer stanley stefan stephen steve steven stewart
stuart terence terry theodore thomas tim timothy tobias todd tom tony travis trevor
tyler victor vincent walter warren wayne wesley william wojciech zachary
`.trim().split(/\s+/))

export type Guess = 'female' | 'male' | 'unknown'

/**
 * Guess from a given name. Returns 'unknown' when there is no signal, which the
 * caller should treat as "include and let a human look" rather than "exclude".
 */
export function guessGender(fullName: string): Guess {
  const first = String(fullName || '').trim().split(/[\s,]+/)[0]
    .toLowerCase().replace(/[^a-ząćęłńóśźż]/g, '')
  if (!first || first.length < 2) return 'unknown'
  if (FEMALE.has(first)) return 'female'
  if (MALE_COMMON.has(first) || MALE.has(first)) return 'male'
  // Polish, Italian and Spanish feminine forms almost always end in -a, and the
  // common masculine exceptions are vetoed above. Worth the extra recall on a
  // list that includes Poland.
  if (/[aąi]$/.test(first) && !/(a|i)sha$/.test(first)) return 'female'
  return 'unknown'
}
