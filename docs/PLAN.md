# Plan

## Mål
En webbapp där man följer en egen lista med ungefär 20 simmare och ser senaste
resultat, personbästa och bästa tider per distans. Den ska fungera lika bra på
mobil som på dator. Man söker och lägger till simmare och uppdaterar direkt i
appen, utan bokmärken eller installation. Gränssnittet finns på svenska,
engelska och finska.

Svenska Tempus Open är huvudmålet. Finland, och troligen Färöarna, kör samma
plattform och fungerar med `site=fi`.

## Principer
- **Vara snäll mot Tempus Open.** Hämta bara när en användare ber om det, cacha
  på kanten och samla inte in data i stor skala.
- **Ingen egen databas med persondata.** Listan sparas i användarens webbläsare.
- **Inga beroenden.** Appen är ren HTML, CSS och JavaScript, och Worker-koden
  är ren JavaScript.

## Tempus Open i korthet (kartlagt oktober 2026)
- Plattformen bygger på Laravel och Inertia. Varje sida bäddar in sina data som
  JSON i attributet `data-page`.
- `/swimmers/<id>/swimming` ger bästa tid per gren i `results_short` (25 m) och
  `results_long` (50 m), med filtret `from_date`/`to_date`. Det går inte att
  stänga av "bara bästa tid" via URL.
- `/swimmers/<id>/events/<kod>` ger alla lopp i grenen i `all_results`.
  `swim_event.id` är ett internt ID och inte grenkoden; den finns som
  `event_code` på varje rad.
- Sökning görs med POST `/swimmers` och kräver Laravels session- och XSRF-cookies
  från en GET först.
- Sajten saknar CORS, så webbläsare kan inte anropa den från andra domäner.
- Vissa lopp ligger dubbelt med samma tid, samma tävling och dagen efter.
  De filtreras bort.

## Etapper
1. ✅ **Grund.** Worker-API (sök, profil, gren), app med sök och lägg till,
   simmarkort, detaljvy med personbästa, periodbästa, topp 3/5/10/alla och
   utvecklingsgraf.
2. ✅ **Bevakningslista.** Perioder (denna säsong, 12 månader, förra säsongen),
   nya personbästa markerade, uppdateringsknapp, delning via länk,
   mobil- och desktoplayout, tre språk.
3. **Driftsättning.** Pages och Worker kopplas ihop och testas mot riktig data.
4. **Topplistor och statistik**
   - Topplistor i den egna listan: ✅ per gren och bassänglängd, filter på kön.
     Senare även årskull och åldersklass.
   - Säsongsbästa per säsong i en tabell, utveckling över säsonger
   - Förbättring i procent eller sekunder, till exempel "mest förbättrade"
   - Bästa lopp efter AQUA-poäng, oavsett gren
   - Jämförelse mellan två eller flera simmare, grenvis
   - Klubbvy: alla simmare i en klubb, om Tempus erbjuder det på ett snällt sätt
5. **Senare**
   - Riktiga "senaste lopp" och inte bara periodbästa. Det kräver att
     grensidorna hämtas och bör göras med försiktig cachning.
   - Mellantider, om de finns i Tempus
   - Export till CSV eller Excel
   - Notiser om nya personbästa
   - Installera som app (PWA, offline)
