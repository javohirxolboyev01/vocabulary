# Vocab

Inglizcha so'zlarni Leitner tizimi (oraliqli takrorlash) bilan yodlash uchun web ilova. Backend yo'q: hammasi brauzerda ishlaydi.

## Ishga tushirish

```bash
npm run dev
```

Ilova http://localhost:3000 da ochiladi. Yoki shunchaki `web/index.html` ni ikki marta bosing — paket o'rnatish shart emas.

## Imkoniyatlar

- **Asosiy:** "English Vocabulary in Use — Elementary" kitobining 60 ta uniti (~1470 so'z) darhol ochiq — unitni bosing va o'rganing. Kunlik maqsad halqasi (20 ta javob), streak, "Davom ettirish" kartasi.
- **Kartochka:** 3D aylanadi (bosing yoki ↻), "Bilaman" / "Bilmayman" tugmalari doim ko'rinadi, kartani o'ngga/chapga surib ham javob berish mumkin. 🔊 talaffuz. Klaviatura: Space — aylantirish, → bilaman, ← bilmayman, Esc — yopish.
- **Takrorlash:** vaqti kelgan barcha so'zlar (Leitner jadvali bo'yicha).
- **Lug'at:** barcha so'zlar, qidiruv va filtrlar; o'z so'zingizni qo'shish.
- **Statistika:** streak, so'nggi 7 kun faolligi, qutilar bo'yicha taqsimot, zaxira nusxa.

## Ma'lumotlar qayerda saqlanadi

Progress brauzerning `localStorage` ida saqlanadi: faqat shu brauzer va shu qurilmada. Brauzer ma'lumotlari tozalansa, progress ham o'chadi. Shuning uchun **Statistika → Zaxira nusxa** orqali vaqti-vaqti bilan PDF zaxira yuklab oling: unda statistika va o'rganilgan so'zlar jadvali bor, progress ma'lumoti esa fayl ichiga yashirilgan. Boshqa qurilmada shu PDF ni (yoki eski JSON zaxirani) "Tiklash" orqali ochsangiz progress o'tadi.

## Leitner qoidasi

7 ta quti. Yangi so'zga birinchi "Bilaman" → 1-quti (ertaga yana tekshiriladi), keyingi "Bilaman" → bir quti yuqoriga. "Bilmayman" → 2 quti pastga (eng kami 1-quti) va 10 daqiqadan keyin qayta chiqadi.
Oraliqlar: 1-quti 1 kun, 2-quti 3 kun, 3-quti 7 kun, 4-quti 14 kun, 5-quti 30 kun, 6-quti 60 kun, 7-quti 120 kun; har biriga ±10% tasodifiy farq qo'shiladi. 7-qutidagilar yodlangan hisoblanadi (`web/app.js`).

## To'plamlar

Manba fayllar `data/` da: `data/packs.json` (katalog), `data/a1.json`, `data/evu/unitNN.json`. Kitob so'zlari kitobdagi qalin (asosiy) so'zlardan olingan; o'zbekcha tarjimalar va misol gaplar alohida yozilgan, kitobdan ko'chirilmagan.

Yangi to'plam qo'shish yoki tarjimani tuzatish: `data/` dagi JSON ni o'zgartiring, so'ng

```bash
npm run build:packs     # yoki: node scripts/build-packs.js
```

Bu `web/packs.js` ni qayta yaratadi (ilova to'plamlarni shu fayldan o'qiydi, shuning uchun serversiz ishlaydi).

## Internetga joylash

`web/` papkasini istalgan statik hostingga (GitHub Pages, Netlify, Vercel) yuklash kifoya.
