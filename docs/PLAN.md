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
3. ✅ **Driftsättning.** Pages och Worker publiceras automatiskt, versionsnummer och cache-busting.
4. **Topplistor och statistik**
   - Topplistor i den egna listan: ✅ per gren och bassänglängd, ✅ personbästa
     eller periodbästa, ✅ AQUA-poäng över alla grenar, ✅ filter på kön och årskull.
     Senare: listans snabbaste lopp, där samma simmare kan förekomma flera gånger.
   - ✅ Säsongsbästa per säsong i en tabell, med förändring mot föregående säsong
   - ✅ Förbättring i procent och sekunder mot PB före perioden; topplista "Förbättring"
   - ✅ Bästa grenar efter AQUA-poäng på korten
   - ✅ Jämförelse mellan upp till fyra simmare, grenvis, med export till CSV
   - ✅ Fliken Tävlingar: alla lopp per tävling, senaste först, med PB markerade
   - ✅ Kvaltider 2026 (SM/U21-SM A och B, USM per åldersklass, Para-SM A och B per klass):
     märken på korten och i grentabellen, "kvar till nästa", egen flik med alla tider.
     Data i `tools/qual-source-2026.txt`, byggs med `node tools/build-qual.js 2026`.
     Nya versioner av PDF:erna måste föras in för hand (eller via en schemalagd kontroll).
   - ✅ Placering i Sverige bland födda samma år, per gren och period (Tempus statistik, från 13 år),
     hämtas först när grenen öppnas och cachas 6 timmar
   - ✅ Klubbsök: sök per klubb, bara aktiva, kön, fler sidor, lägg till alla (max 30 åt gången)
   - ✅ Masters (v0.30.0): procent av World Aquatics världsrekord i masters för åldersgruppen när loppet simmades
     (25–29 … 105–109, kort- och långbana). Källa `tools/masters-source-2026.txt` (bara tider, inga namn), byggs med
     `node tools/build-masters.js 2026`. Visas från det år simmaren fyller 25: kolumnen % VR, bästa grenar, topplista.
   - ✅ Profil: spindeldiagram per simsätt, sprint/mellan/distans, form (senaste loppen mot PB)
   - ✅ Prognos: när nästa kvaltid nås i nuvarande takt (trend senaste 24 mån)
   - ✅ Inbördes möten mellan två simmare i Jämför
5. **Senare**
   - ✗ Mellantider: finns inte i Tempus Open (troligen bara i livetimingen)
   - ✅ Synk mellan enheter: hemlig synklänk/QR-kod, Cloudflare KV, bara Tempus-ID, ordning och paraklass lagras
     (KV-nyckeln är en hash av länken). Senaste ändring vinner; listor som inte rörts på ~13 månader försvinner.
   - ✅ "Nytt sedan sist": nya PB sedan förra besöket markeras på korten, sammanfattning och sortering
   - ✅ Push-notiser om nya PB (v0.19.0): Web Push (RFC 8291/8292) från Workern, VAPID-nycklar skapas i KV vid
     första användning, cron var 6:e timme jämför simmarnas PB mot senaste ögonblicksbild. Lagras: hash av
     notisadressen, notisnycklar, Tempus-ID och språk. Kryptering verifierad mot http_ece.
   - ✅ Installera som app (service worker, fungerar offline med senast hämtade data)
   - "Senaste lopp" direkt på korten (kräver grensidor för alla i listan, alltså fler anrop)
   - ✅ Kortanpassning: välj vilka delar korten visar (per enhet, v0.18.0)
   - ✅ Egna mål per gren: sätts i grenvyn, mållinje i grafen, märken i tabellen, sammanfattning på kortet, synkas

## Önskemål oktober 2026 (efter test)
- ✅ Senaste lopp i grenvyn: växla Snabbast/Senaste, 3/5/7/10/alla (v0.16.0)
- ✅ Längre perioder: äldre säsonger och "Alla år" i periodmenyn (v0.16.0)
- ✅ WPS-poäng för parasimmare (v0.29.0): World Para Swimming Point Scores 2024, långbana, version 1.
  q = 1200 · e^(−e^(b − c/p)), parametrar per gren, klass och kön i `tools/wps-source-2024.txt`,
  byggs med `node tools/build-wps.js 2024`. Bara 50 m (ingen kortbanetabell publicerad). Visas i grentabellen,
  i loppslistan, som bästa grenar på kortet och som "Alla grenar (WPS-poäng)" i topplistan. Ny tabell → uppdatera källfilen.
- ✅ Importera simmare från startlista/resultatlista (v0.17.0): klistra in text, namn/år/klubb tolkas i
  webbläsaren, matchas mot Tempus (namn, födelseår, klubb), välj per gren, klubb eller enskild simmare. Max 80 namn.
- ✅ Slogan "Bakom varje rekord." och © i sidfoten (v0.17.0)
- Livetider från Swimify: Swimifys data kräver deras egen klientnyckel, så den används inte utan tillstånd.
  Alternativ: länk till tävlingen på live.swimify.com, och fråga Swimify/IC Control om ett API.
- Namn och slogan: behåll SwimDeck tills vidare, välj slogan.
- ✅ Resultatlista per tävling (v0.20.0): tryck på en tävling i Grenar eller Tävlingar. Tempus lagrar ingen placering
  per lopp (`event_position` är bara loppets plats bland simmarens egna lopp), så placeringen räknas fram från
  tävlingens resultatlista (`/competitions/swimming/<id>`, filter gren + klass), alla åldrar.
  v0.21.0: "Totalt" placerar efter längsta omgång (final före semifinal före försök), sedan tid i den omgången;
  flikar per omgång. Större tävlingar (SM, USM, Swim Open) har Heat/Final i Tempus. Mindre tävlingar märker ibland
  allt som "Final"; då räknas bästa tid och appen säger att placeringen kan avvika. A/B-finaler och åldersfinaler
  (USM) heter också "Final" i Tempus, därför finns filtret "Födda <år>" (v0.22.0).
  Tävlingen hittas via namn och datum. Cachas 6 timmar.
- ✅ v0.23.0: topplista med en distans på båda banlängderna (två kolumner, sortera per kolumn), period "Senaste 24 mån",
  logga/namn leder till startsidan, kvaltider "Klarade" (översikt per simmare, båda banor), "Vad visas här?" i varje vy
  och sidan "Om SwimDeck" med begrepp. Tempus skiljer inte på inne och ute, bara 25/50 m.
- ✅ v0.26.0: importera från tävling i Tempus. Sök tävling (senaste året), välj klubb (förvald: klubben flest i listan
  tillhör), filtrera på kön och årskull, gruppera på årskull eller gren, markera hela grupper. Läser resultatlistan per
  klubb och kön (max 20 sidor à 20 rader per kön); "Alla klubbar" bara på tävlingar med högst 400 resultat.
- ✅ v0.31.0: procent av aktuellt världsrekord för alla åldrar (World Aquatics, `tools/wr-source.txt`, byggs med
  `node tools/build-records.js`). Rad i grenvyn (världsrekord och mastersrekord mot PB) och "Alla grenar (% av världsrekord)"
  i topplistan. Masterskolumnen heter nu "Masters %".
