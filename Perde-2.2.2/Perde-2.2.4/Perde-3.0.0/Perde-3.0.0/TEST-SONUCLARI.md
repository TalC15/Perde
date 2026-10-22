# Perde doğrulama notları — 22 Ekim 2026 (3.1.1)

## 3.1.1 · kadınlar modunda erkeklerin açılması

- **83/83 JavaScript testi geçti.** Yeni/değişen: analiz aralığı kadar ara verilse de kararın korunması, uzun aradan sonra yeniden başlaması, yüzlerin bire bir kişi eşlemesi, komşu yüzün kendi örtüsünü alması, öndeki erkeğin başı için örtüde boşluk ve yüz konumunun kutuyla taşınması.
- **Gerçek kareler** (`.integration-claude-tmp/eval/frames.cjs`, iki gerçek YouTube klibi, 180 kare, eklentinin gerçek motor yolu): net yüzlerde erkekler 0,85–1,00, kadın sunucu 0,02. Tam çözünürlüklü kırpımla küçük kadın işaret dili çevirmeni değerlendirilebilir hâle geldi ve kadın çıktı (0,14–0,39). 0,6–0,9 aralığındaki 63 yüzün elle incelemesinde kadınların en yüksek değeri 0,70 idi. Ayna görüntüsüyle ortalama denendi, belirgin fark yaratmadığı için alınmadı.
- **Oynatma ölçümü** (`playclip.cjs`, 40–55 sn, 0,5 sn’de bir sayım, başsız Brave): haber klibi açık erkek görülen ölçüm 0/77 → 59/77, talk show 2/77 → 61/76; kadın ağırlıklı iki klipte (101’er ölçüm) açılan kişilerin hepsi erkek sunucuydu, hiçbir kadın açılmadı. Kare kaybı %0–1,4, analiz medyanı 141→149 ms ve 122→141 ms. Ekran görüntüleri elle incelendi. Canlı YouTube oynatıcısında ölçülmedi.

## 3.1.0 · kadın odaklı örtü, vokal hataları, ekran kartı ve izlerken hazırlama

- **82/82 JavaScript testi geçti** (`node --test tests/*.test.cjs`). Yeni: cinsiyet kararları ve izleme, MP3 kare dizini (rastgele parça sınırlarında yalnız tam kareler), büyüyen kaydın ilk bölümünün oynatılması, hazırlanan kısmın ötesinde vokalin susması, ayırma hatasının nedeniyle bildirilmesi.
- **88/88 Python testi geçti**: 27 soketsiz servis, 13 HTTP servis, 14 ses seçimi, 14 kayıt, 4 CPU, 3 ses akışı, 2 süreç, 7 güvenilirlik, 4 akış. Güvenilirlik testi Windows’ta durum dosyası yarışını gerçek iki süreçle kurar: eski kod 300 güncellemenin 62’sinde işi düşürdü, yeni kod hiçbirinde.
- **Gerçek uçtan uca test** (`tests/browser-stream-real.cjs`, gerçek servis, gerçek YouTube sesi, 3:33 müzik videosu, ekran kartı/DirectML): ilk vokal **34,2 sn**’de oynatılabildi; video–vokal farkı ortanca **51 ms**; hazırlanan kısmın sonuna atlanınca video durdu ve 17 sn sonra kendiliğinden devam etti; Media Source penceresinden çıkmış başa geri sarma çalıştı; tamamı **138,4 sn**’de aktarıldı ve tarayıcı kitaplığına kaydedildi. Sayfa yerel bir sessiz video örneğidir; canlı YouTube oynatıcısı değildir.
- **Ses ayırma ölçümleri** (bu bilgisayar, AMD Radeon, DirectML): MDX-Net 30 sn ses 12,2 sn’de, 171 sn’lik şarkı 60,5 sn’de (2,8× gerçek zaman). İşlemcide MDX ~0,9×, Demucs ~1,2×. MUSDB18 örnek kesitinde vokal SDR: MDX 8,88 dB, Demucs 8,09 dB. STFT/ISTFT uygulaması PyTorch ile karşılaştırıldı (bağıl hata 2·10⁻⁷).
- **Kurulum** `BASLAT.cmd` ile gerçekten çalıştırıldı: `onnxruntime-directml` kuruldu, model indirildi ve SHA-256 ile doğrulandı.
- **Görsel**: 165 yüzlük örnek sette cinsiyet doğruluğu %98,8; video kare kaybı koruma açıkken %10–14’ten %1–2’ye indi (başsız Brave, 12 sn örnek video). Canlı YouTube’da ölçülmedi.
- `tests/browser-audio-integration.cjs`, `browser-controls.cjs` ve `browser-library-smoke.cjs` gerçek Brave’da geçti. Entegrasyon testi 3.0.0’da da zaman aşımına uğruyordu: başsız tarayıcıda arka plan ses belgesi ~11 sn’de açılıyor, testin sabit beklemeleri (15 sn / 3 sn) yetmiyordu; beklemeler uzatıldı. `SHA256SUMS.json` yeniden üretildi (99 dosya, hepsi git’te izleniyor).


## 3.0.0 · bağlantı, sürükleme ve arka plan müziği

- **72/72 JavaScript testi geçti.** Yeni kontroller: hatalı anahtarın çalışan bağlantıyı koruması, eşzamanlı bağlantı istekleri, eski durum yanıtlarının elenmesi, kayıp servis işi ve saklanan anahtarla yeniden bağlanma, sayfa yenilemeden başarısız başlatmanın toparlanması, iptal edilen isteğin tekrar başlamaması, tek MP3 seçimi/silme, döngü zamanlaması, ses/hız/duraklama ve geç tamamlanan okumanın iptali. Vokal sonundan ileri video zamanı sesi tekrar başlatmıyor.
- **34/34 Python regresyon testi geçti:** 27 soketsiz servis, 4 CPU ve 3 ses akışı testi. Son grup NumPy içeren mevcut ses servisi ortamıyla çalıştırıldı; genel sistem Python’unda NumPy yok.
- **`tests/v3-browser.cjs` gerçek Brave testini geçti:** sentetik gerçek MP3 ile çoklu dosya ekleme, içerik özetiyle tekilleştirme, indirme, önizleme, tarayıcı kapanıp açıldıktan sonra saklama, tek checkbox seçimi, fareyle sürükleme, sayfa yenilemede konumun korunması ve sıfırlama. Gerçek ses çözücüsüyle vokal + MP3, döngü ayarı, ses seviyesi, hız, duraklama ve iletişim zaman aşımında susturma doğrulandı. Seçilen dosyayı silmek seçimi de temizliyor. Eşzamanlı 12 kayıt isteğinde 10 parça sınırı aşılmıyor.
- **Mevcut gerçek tarayıcı kontrolleri geçti:** `browser-library-smoke.cjs --screenshots` kayıtlı vokal arşivini ve sayfa yenilemede otomatik açılmayı; `player-controls-browser.cjs` YouTube benzeri oynatıcı kontrollerinin görünür ve tıklanabilir kalmasını doğruladı.
- MP3 kitaplığı ve taşınmış vokal panelinin ekran görüntüleri incelendi. Testler ayrı tarayıcı profillerinde, ağ erişimi kapalı ve YouTube sayfası yerel örnekle değiştirilerek çalışır. Canlı YouTube/gerçek servis bağlantısı veya uzun Demucs ayırma bu sürümde tekrar ölçülmedi. Dosya sınırları 10 parça / parça başına 25 MiB; kişisel şarkı kullanılmadı.
- Manifest ve görünür sürüm 3.0.0. Mevcut vokal veritabanının adı/şeması değiştirilmedi. Kaynak klasörü taşınmadı; aynı eklentiyi yenilemek kayıtları korur. MP3 veritabanı ayrıdır ve dağıtım ZIP’ine dahil değildir.

## Oynatıcı kontrolleri, arayüz ve CPU kullanımı

- **59/59 JavaScript testi geçti:** mevcut kayıt/aktarım/sahiplik kontrollerine panel sekmeleri, klavye erişimi, silme onayı, gerçek servis durumu ve tam ekran vokal kutusunun konumlandırılması eklendi.
- **34/34 Python testi geçti:** 4 CPU kaynak sınırı testi, 27 soketsiz servis testi ve 3 ses akışı testi.
- `tests/player-controls-browser.cjs` gerçek Brave'da eski `z-index:8` kuralıyla hatayı yeniden üretti. Düzeltme sonrası ilerleme, ses, ayarlar ve menülerin hem görünürlüğü (piksel kontrolü) hem tıklanabilirliği doğrulandı. İnsan maskeleri, başka bir özel oynatıcıdaki kontroller ve ölçekli hizalama kontrol edildi. Sayfalar yerel örneklerdir; insan algılama taklittir, canlı YouTube testi değildir.
- `tests/browser-library-smoke.cjs --screenshots` gerçek tarayıcıyla kayıtların yeniden açılışta korunmasını, yeni panel sekmelerini, kayıttan otomatik açmayı ve sayfa yenilemeyi doğruladı. Koruma/Vokaller/Ayarlar ve video üzerindeki vokal paneli görüntüleri incelendi. Görüntüler ve test profilleri dağıtım paketine dahil edilmez.

Gerçek yerel `htdemucs` modeliyle aynı 10 saniyelik sentetik stereo ses iki sırada ölçüldü. İlk sıra eski/yeni, ikinci sıra yeni/eskiydi. Eski 6 intra-op/6 inter-op ayarıyla süreler **11,469 ve 10,703 saniye**; yeni 4/1 ayarıyla **10,188 ve 9,797 saniye**. Ortalamalar **11,086 → 9,9925 saniye (%9,86 daha kısa)**, CPU zamanı **42,039 → 29,813 CPU-saniye (%29,08 daha az iş)**, tepe çalışma belleği **1695,65 → 1657,7 MiB** oldu. Model, shifts=0, overlap=0.25 ve 30 saniyelik bloklar değişmedi. Üretimdeki `separate()` yolu ayrıca gerçek 2 saniyelik ses, 88.200 örnek ve FFmpeg MP3 kodlamasıyla doğrulandı. 30–40 dakikalık tam model çalışması veya başka uygulamalar açıkken toplam sistem yükü yeniden ölçülmedi.

Kaynak sınırları model çalışmadan önce uygulanır. Bunun sıralama gereksinimi PyTorch'un [intra-op](https://docs.pytorch.org/docs/2.14/generated/torch.set_num_threads.html) ve [inter-op](https://docs.pytorch.org/docs/2.14/generated/torch.set_num_interop_threads.html) belgelerine uygundur. Windows düşük işlem önceliği bir zamanlama tercihidir; mutlak CPU/RAM kotası değildir. Ölçüm aracı: `tests/benchmark_cpu.py`; model dosyaları mevcut değilse ölçüm yeni model indirmez.

## Perde-2.2.4 klasöründeki tarayıcı vokal kütüphanesi güncellemesi

- Eklenti davranışı, ses aktarımı, tarayıcı kayıtları, otomatik açma ve panel: **51/51 test geçti**. Sayfa yenilemede kayıt kullanımı; oynayan/duraklatılmış videonun durumu; video değişimi; eski sayfanın yeni oturumu iptal edememesi; kayıt tercihinin korunması; servissiz kullanım; tekli/toplu silme; eksik aktarımın devamı ve kayıt hatasında mevcut sesin oynatılabilmesi kapsanır. Bu testlerde DOM ve IndexedDB kontrollü taklitlerdir.
- Servis ve eski disk kayıtları: **27/27 test geçti**. Gerçek HTTP işleyicileri soket açmadan bellek akışlarıyla çalıştırıldı. Eski kayıt sorgusu, yalnız kayıt açma isteğinin eksik/bozuk dosyada yeni ayırma başlatmaması, yetkilendirme ve süre sınırları doğrulandı.
- **Gerçek Brave tarayıcısı testi geçti:** izole profilde gerçek IndexedDB'ye sentetik ses yazıldı; tarayıcı tamamen kapatılıp aynı profille açıldı; kayıt bilgileri ve ses baytları karşılaştırıldı; paneldeki liste ve yerel servis olmadan arka plan ses belgesine yükleme doğrulandı. Test kaydı silindi. Kullanıcının tarayıcı profili veya kişisel sesleri testte kullanılmadı; yerel HTTP sunucusu açılmadı.
- Aynı gerçek tarayıcı testinde YouTube adresindeki istek tamamen yerel bir örnek sayfayla karşılandı: kayıtlı vokal otomatik açıldı, kaynak video sessize alındı, duraklatılmış video duraklatılmış kaldı ve gerçek panelde oluşturma düğmesi gizlendi. Sayfa yenilemeden sonra yeni sayfa oturumu aynı kaydı tekrar yükledi. Servis anahtarı ve dış ağ isteği kullanılmadı. Bu senaryo canlı YouTube sayfası veya gerçek ses ayırma testi değildir.

Bu güncellemede gerçek YouTube'dan indirme ve 30–40 dakikalık Demucs işlemi yeniden çalıştırılmadı. Önceki ölçümler aşağıda tarihsel kayıt olarak tutulur. Yeni `unlimitedStorage` izni tarayıcıdaki vokal dosyaları içindir; eklentiyi kaldırma/verilerini temizleme kayıtları silebilir.

## Son düzenleme: görsel etiketleme kaldırıldı

Elle kişi etiketleme arayüzü ve kategori filtreleri kullanıcının talebiyle kaldırıldı. Otomatik insan/yüz algılama ve bütün insan bölgelerini örtme davranışı devam eder. Ses aktarımı ve isteğe bağlı vokal kütüphanesi korunur. Bu düzenlemenin ardından eklentide kalan 16 davranış/aktarım testi ve JavaScript sözdizimi kontrolleri geçti. Gerçek tarayıcı testi bu düzenlemede çalıştırılmadı.

## Önceki ses iyileştirmelerinde çalıştırılan kontroller

- Eklenti davranışı ve aktarım: **17/17 geçti** (`node --test tests/*.test.cjs`). Parça aktarımının kaldığı yerden devamı, üç başarısız deneme, eksik/aşırı büyük veri reddi, iptalde bağlantının durdurulması, aktarım sırasında yanıt verebilen durum sorgusu, hazır dosyadan yeniden deneme, kayıt tercihinin servise iletilmesi, sonradan kaydetme ve elle verilen kategorilere göre maske filtresi. Tarayıcı/DOM bu testlerde taklittir; görsel yerleşim testi değildir.
- Servis ve kalıcı kayıt: **22/22 geçti** (`python tests/test_service_inprocess.py`). Üretim HTTP işleyicileri bellek akışlarıyla çalıştırıldı; ağ soketi açılmadı. Yetkilendirme, süre sınırı, byte aralıkları, iptal/temizlik, kayıtların servis yeniden açılışında kullanılması, kayıt kapalıyken kalıcı dosya oluşturmama, sonradan kayıt, son durum sorgusundan önce normal kapanışta tamamlanmış kaydı koruma, bozuk kopya reddi, disk hatasında oynatılabilir dosyayı koruma ve kayıtları silme doğrulandı.
- Ses akışı: **3/3 geçti** (`vocal-service/.venv/Scripts/python.exe tests/test_audio_stream.py`). 40 dakika için sınırlı blok boyutu ve örnek doğruluğu; model yerine kimlik dönüşümü.
- Ses dili seçimi ve kilitli klasör temizleme: **12/12 geçti**. `AudioSelectionTests` ve `CleanupTests.test_locked_directory_is_retried_and_configuration_is_preserved` çalıştırıldı.

**Toplam 54 test geçti.** Gerçek yerel HTTP testleri çalışma ortamının bağlantı kısıtıyla engellendi (Windows 10013). Kısıt dışında çalıştırma isteği reddedildi; tekrar denenmedi. Gerçek tarayıcıdan servise aktarım, yeni kontrollerin görsel yerleşimi ve 30–40 dakikalık gerçek YouTube/Demucs işlemi bu güncellemede doğrulanmadı. Önceki aşağıdaki ölçümler yeni değişikliklere ait değildir.

Aktarım hatasının olası kod kaynakları: tek dosyalık istekte 30 saniye sınırı, aktarım boyunca açık tutulan mesaj yanıtı ve HTTP işleyicisinde dosya gönderimi sırasında tutulan iş kilidi. Yeni kod 1 MiB aralıklar, parça bazlı yeniden deneme, kısa durum yanıtları ve kilit dışında dosya gönderimi kullanır. Kullanıcının özgül hatasını gösteren çalışma kaydı mevcut değildi; bütün “Failed to fetch” nedenlerinin giderildiği iddia edilmez.

Arka plan belgesinin kapanması durumunda hazır sunucu dosyası yeniden yüklenir. Chrome'un ses oynatma amacıyla açılan belgeler için yaşam döngüsü sınırı ayrıca vardır: [resmî offscreen belgesi](https://developer.chrome.com/docs/extensions/reference/api/offscreen#reasons).

## Önceki doğrulama notları — 8 Ekim 2026

Bu sürümde 40 dakikalık vokal desteği, sınırlı bellekle blok işleme, hazırlama ilerlemesi ve açık oturum bildirimi eklendi. Yalnızca kadınları otomatik hedefleme uygulanmadı; görsel motor bütün insanları hedeflemeye devam eder.

## Tamamlanan kontroller

| Kontrol | Sonuç ve kapsam |
| --- | --- |
| Eklenti davranış testleri | **9/9 geçti.** Ayar sınırları, video kimliği, maske takibi, anahtar erişimi, iş sahipliği, video değişiminde iptal, sesin durması ve oturum bildirimi. |
| Yerel HTTP servis testleri | **13/13 geçti.** Gerçek yerel HTTP; anahtar, Host/Origin, 40 dakika sınırı, 120 dakika hazırlama sınırı, süre/kimlik doğrulama, iptal, etkin oturumun korunması, ilerlemeyen işin seslerinin silinmesi, durum dosyasının iş meta verisini değiştirememesi. İşçi başlatma bu testlerde taklittir. |
| Ses blok testleri | **3/3 geçti.** 15 farklı sınır uzunluğu, tek örnekli/kısa dosyalar, örtüşmeler, son bloklar, geçersiz model çıktısı ve 40 dakikalık akışta 30 saniyeden büyük bloğun modele ulaşmaması. Kimlik dönüşümüyle örnek hizası doğrulanır. |
| Gerçek Manifest V3 görüntü testi | İnsan + yüz modelleri WebGL ile çalıştı; boş görüntüde çıkarım, ayar kaydı, kaynak değişiminde örtünün korunması ve kapatılması geçti. Ayrı Brave profili kullanıldı. |
| Tarayıcı kontrol testi | 40 dakika uzunluğunda gerçek HTML medya öğesi; ilerleme yüzdesi, oturum bildirimi, 39. dakikaya sarma, hız, reklamda durma ve önceki sessiz duruma dönme geçti. Servis cevapları taklittir. |
| Eklenti–HTTP–ses bütünleşmesi | Gerçek eklenti betikleri, yetkili yerel HTTP ve gerçek offscreen ses öğesiyle oynatma, sarma, hız, reklamda durma/devam, iptal ve sunucuya silme isteği geçti. Servis yapay ses verir. Test kopyasına localhost izni önceden eklenir; izin isteme arayüzü bu testin kapsamında değildir. |
| Sözdizimi | Güncellenen JavaScript ve Python dosyaları geçti. |

## Uzun gerçek model testi

**Geçti.** 25 dakikalık, 44.100 Hz stereo yapay ses gerçek Demucs modeliyle bu bilgisayarın işlemcisinde işlendi. Ayırma ve MP3 kodlama/yeniden çözme kontrolleri toplam **1.615,8 saniye (26 dakika 55,8 saniye)** sürdü. Ayırma 1.594,0 saniyede tamamlandı; model önceden indirilmişti, bu ölçüm YouTube indirme süresini içermez.

- İşlemin en yüksek çalışma belleği: **1.934,3 MB (yaklaşık 1,93 GB)**.
- Çıkış: **kanal başına 66.150.000 örnek**, 44.100 Hz, stereo; tüm değerler sonlu.
- 192 kbit/sn MP3 boyutu: **36.001.375 bayt**. MP3 yeniden çözüldüğünde örnek sayısı aynı kaldı; zaman çizelgesinde uzunluk kaybı olmadı.
- Kişisel dosya kullanılmadı; geçici giriş ve çıkış sesleri test sonunda silindi.

Ölçüm kaydı: [tests/long-audio-result.json](tests/long-audio-result.json). Bu test uzun işlem kararlılığını ve ses uzunluğunu doğrular; sesin insan kulağıyla algılanan kalitesini ölçmez. Gerçek müziklerde ayırma kalitesi ve işlem süresi farklı olabilir.

## Önceki sürümde doğrulananlar

2.1 sürümünde 19 saniyelik herkese açık YouTube örneği (`jNQXAC9IVRw`) indirme → Demucs → MP3 akışında 25,1 saniyede işlendi. Çerez kullanılmadı ve test sesleri silindi. Bu geliştirme örneği kullanıcı geçmişi değildir. Bu 2.2 turunda dışarıdan yeni YouTube videosu indirilmedi.

## Sınırlar

Günlük kullanıcı profilindeki gerçek YouTube reklamları, çoklu dublaj, farklı sitelerde kapsamlı uyumluluk ve ses kalitesinin dinleyici değerlendirmesi yapılmadı. İşaretlenmiş reklam senaryosu ile canlı reklam trafiği aynı test değildir. Kişi kaçırma oranı veri kümesiyle ölçülmedi. Bağımsız güvenlik denetimi yapılmadı. Bu rapor hatasızlık veya güvenlik sertifikası değildir.

Orijinal görüntü kütüphaneleri değiştirilmedi. TensorFlow'un regenerator global değişkeni için önceki sürümde eklenen tanım, güvenlik politikasını gevşetmeden yükleme sorununu çözüyor.

## Başlatıcı düzeltmesi

ZIP kopyasında bulunmayan `.venv` yolunun doğrudan çağrılması düzeltildi. `BASLAT.cmd` önce çalışma ortamını kontrol eder; eksik bileşenleri kurar. Bu bilgisayardaki açılmış ZIP kopyası mevcut Python ortamına ve model önbelleğine bağlandı. Makineye özel yollar `.runtime/environment.json` dosyasındadır ve dağıtım paketine girmez. Her iki kopyada bağımlılık kontrolü, gerçek CMD üzerinden kimlik istemine ulaşma ve geçersiz kimlik reddi doğrulandı. Ortamı olmayan kopyada açıklayıcı kurulum mesajı kontrol edildi. Bu kontrolde yeniden ses ayırma veya canlı servis bağlantısı çalıştırılmadı.

## Pencere kapanışında kilitli ses düzeltmesi — 8 Ekim 2026

Kapanan servis penceresinin ardında çalışan Windows ses işçisinin `input.wav` dosyasını kilitlemesi doğrulandı. Yalnızca bu işe ait işlem ağacı durduruldu ve artık kullanılmayan geçici ses klasörü temizlendi. Servis, işçi oluşturmadan önce Windows Job Object kapsamına alınır; servis işlemi zorla sonlanınca çocuk ve torun işlemler de işletim sistemi tarafından kapanır. Kilitli eski klasörler açılışı engellemez; temizlik 20 saniyelik aralıklarla yeniden denenir, etkin işler ve ortam ayarı korunur.

İki yeni gerileme kontrolü geçti: gerçek kilitli dosya üzerinde ebeveyni zorla kapatıp çocuk/torun işlemlerin kapanması ve dosyanın temizlenmesi; geçici kilitte yeniden deneme sırasında etkin klasör/ayarın korunması. Mevcut 12 servis testi yeniden geçti. Kullanılan kopyada gerçek servis art arda iki kez açılıp kapatıldı; WinError 32 oluşmadı. Bu düzeltmede yeniden uzun ses ayırma testi çalıştırılmadı.

## Türkçe ses tercihi — 2.2.1

Türkçe ses erişilebiliyorsa dublaj/orijinal parçanın önüne Türkçe seçimi uygulanır. Yalnız altyazı Türkçe diye yabancı ses Türkçe sayılmaz. Türkçe yoksa mevcut sesle devam edildiği panelde açıkça belirtilir. İndirme tek çıkarımda seçilen formatla yapılır; ikinci bir URL çıkarımı varsayılan dile geri döndüremez. Dil bilgisi indirme, ayırma, kodlama ve hazır durumunda korunur.

14/14 yeni seçim testi geçti: 11 dil/format sınırı ve gerçek kurulu yt-dlp + gerçek FFmpeg ile 3 yerel indirme bütünleşmesi. Bu bütünleşmede YouTube çıkarıcısı ve Demucs taklittir. Türkçe indirme başarısız olduğunda yabancı dile sessiz geçiş yapılmadığı doğrulandı. Güncellenen 9/9 eklenti ve 12/12 servis testi geçti. Tarayıcı kontrolünde Türkçe notu, Türkçe bulunamadı notu, iptal sonrası sıfırlama ve mevcut oynatma/reklam kontrolleri geçti.

Kullanıcının verdiği gerçek YouTube videosunda 1.251 saniyelik içerik için Türkçe ses parçası seçildi. Gerçek Türkçe ses indirimi başarılı oldu (21.779.349 bayt); FFmpeg ile kısa bölüm 4,9931 saniye olarak çözüldü. Çerez veya kişisel dosya kullanılmadı ve geçici sesler silindi. Bu son kontrol Türkçe etiketli gerçek sesin seçimini/indirimini/okunmasını doğrular; bütün videoda yeniden Demucs çalıştırma veya dinleyici kalite değerlendirmesi değildir.

## 40 dakika desteği — 2.2.2

Panelde ve sunucuda 40 dakika seçeneği eklendi; yeni kurulum varsayılanı 40, önceki açık süre seçimleri korunur. İndirme boyut sınırı 160 MB, FFmpeg dönüşüm/kodlama süre sınırı 300 saniye, toplam hazırlama sınırı 120 dakikadır. 10 dakikalık ilerlememe ve 15 dakikalık kullanılmayan oturum temizliği korunur.

Bu değişiklikte 9/9 eklenti, 13/13 yerel servis ve 3/3 ses akış testi geçti. Tam 2.400 saniye kabul edilir; 2.400,01 saniye reddedilir. 91 dakikalık ilerleyen işin korunması, 121 dakikalık işin durdurulması ve seslerinin silinmesi kontrol edildi. Tarayıcıda gerçek 40 dakikalık medya öğesiyle başlangıç, Türkçe bilgisi, 39. dakikaya sarma, hız, reklam ve iptal kontrolleri geçti.

40 dakikalık 44.100 Hz stereo yapay ses, kimlik dönüşümüyle 86 blokta işlendi; en büyük blok 30 saniyeydi. Kanal başına 105.840.000 örnek hem WAV çıkışında hem gerçek MP3 kodlama/yeniden çözme sonrasında korundu. MP3 boyutu 57601296 bayt. Bu medya kontrolü 43.41 saniye sürdü; **Demucs kullanmadığı için bu süre vokal ayırma hızı değildir**. Ölçüm: [tests/long-media-result.json](tests/long-media-result.json). Geçici sesler silindi.

40 dakikanın tamamında gerçek Demucs tekrar çalıştırılmadı. Bellek ve süre değerlendirmesi, önceki gerçek 25 dakika ölçümüne ve değişmeyen 30 saniyelik blok boyutuna dayanır: 1,93 GB işçi belleği ve 26 dakika 55,8 saniye üzerinden yaklaşık 43 dakikalık tahmin. 16 GB RAM ve Ryzen 5 5500 için uygunluk bu verilere dayalı değerlendirmedir; bütün tarayıcı/RAM kullanımı ölçümü veya 40 dakikalık model hız garantisi değildir.
