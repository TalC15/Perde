# Perde 3.1.0 — çalışma notu

HAKKINDA.txt değiştirilmedi. İnsan, yüz ve cinsiyet algılama yereldir. Varsayılan olarak kadınlar ve cinsiyeti belirlenemeyen kişiler örtülür; panelden **Herkes** seçilirse algılanan bütün insanlar örtülür.

## 3.1.0 · kadın odaklı örtü, hızlı vokal ve izlerken hazırlama

**Görsel koruma**

- **Kimler örtülsün: Kadınlar / Herkes** (Koruma sekmesi). Kadınlar modunda her kişinin yüzü cihazda bir cinsiyet modeline gösterilir. Erkek olduğu birkaç bakışta netleşen kişinin örtüsü yumuşakça kalkar; kadınlar, yüzü görünmeyenler ve belirsiz kalanlar örtülü kalır. Örnek 165 yüzlük sette doğruluk %98,8 idi ve dengeli eşikte hiçbir kadın erkek sanılmadı. Bu bir garanti değildir.
- **Örtü görünümü:** **Yumuşak renk** örtülen bölgenin yalnızca ortalama renklerini gösterir (ayrıntı görünmez); **Düz koyu** tek renktir.
- Analiz, ekran kartının yaklaşık en fazla %15’ini kullanacak hızda yapılır; aradaki karelerde maskeler hareket takibiyle kaydırılır. Testte video kare kaybı %10–14’ten %1–2’ye indi. Sahne değişiminde ve sarmada hemen yeni analiz yapılır.
- Modeller ilk açılışta hazırlanır. Cinsiyet modeli hazır olana kadar algılanan herkes örtülür; panel bunu söyler. Modeller (`eklenti/face`, `eklenti/gender`) `@vladmandic/human-models` 3.0.4 paketindendir; lisansı `eklenti/vendor/HUMAN-MODELS-LICENSE.txt`.

**Vokal: hata düzeltmeleri**

- İşlem sürerken çıkan “Ses işlenemedi” hatasının ana nedeni giderildi: servis durum dosyasını okurken Windows (veya virüs tarayıcısı) dosyanın değiştirilmesini reddediyor ve iş düşüyordu. Artık yeniden deneniyor.
- Hata mesajları nedeni söyler: YouTube doğrulaması/403, bağlantı, bellek, disk. İndirme bir kez daha denenir; uzun işlemde bilgisayar uykuya geçmez; servis kısa süre yanıt vermezse panel ~15 saniye bekler.

**Vokal: ekran kartıyla hızlı ayırma**

- Yeni motor **MDX-Net** (UVR-MDX-NET-Voc_FT, ONNX) DirectML ile Windows’taki ekran kartında çalışır. Bu bilgisayarda (AMD Radeon) gerçek zamanın yaklaşık 2,5–2,8 katı hızla ayırır: 40 dakikalık video yaklaşık 15 dakika. İşlemci boş kalır.
- Gerçek bir şarkı kesitinde vokal ayrımı Demucs’tan daha temizdi (SDR 8,9 dB’ye karşı 8,1 dB).
- Ekran kartı kullanılamıyorsa servis Demucs ile işlemcide çalışmaya devam eder (bu bilgisayarda işlemcide Demucs daha hızlıdır). Sürücü işlem sırasında hata verirse iş işlemcide sürer.
- `BASLAT.cmd` gerekli bileşeni (`onnxruntime-directml`) kurar ve modeli bir kez indirir (67 MB, SHA-256 ile doğrulanır). Kurulamazsa uyarı gösterip Demucs ile açılır. Motoru elle seçmek için: `server.py --engine mdx|demucs|auto`.

**Vokal: izlerken hazırlama**

- Vokalin tamamı beklenmez. İlk ~20 saniye hazırlanınca **Oynat**’a basabilirsin; gerçek 3,5 dakikalık testte ilk vokal 34 saniyede çalmaya başladı (indirme dahil). Kalan kısım sen izlerken hazırlanır.
- Video, hazırlanan kısma yetişirse kendiliğinden kısa süre durur ve en az 10 saniyelik vokal hazır olunca devam eder. Panel ilerlemeyi gösterir. Sarma, hız ve duraklatma bu sırada da çalışır.
- Vokal ile video arasındaki fark testte ortanca 51 ms idi. MP3 kodlayıcı gecikmesi (25 ms) servis tarafında düzeltilir.
- Servis, izlediğin yerden 2,5 dakikadan fazla öndeyse yavaşlar; böylece oynatma için kaynak kalır. İzleme yoksa tam hızla biter. Tamamlanınca vokal yine tarayıcıya kaydedilir.

**Güncelleme:** Eklentiyi **Yenile**, YouTube sekmelerini yenile. Servisi kapatıp `vocal-service/BASLAT.cmd` ile yeniden aç (ilk açılışta ekran kartı bileşeni ve model indirilir) ve yeni anahtarı bağla. Eklenti ile servis birlikte güncellenmelidir: eski servis izlerken hazırlamayı desteklemez.

## 3.0.0 · taşınabilir vokal paneli ve MP3 kitaplığı

- Video üzerindeki vokal panelini başlığındaki **⠿** tutamacından sürükle. Konum tarayıcıda hatırlanır ve pencere boyutuna uyarlanır. Tutamaç odaktayken ok tuşlarıyla taşı, Shift ile ince ayar yap; **Konumu sıfırla** veya Home ile otomatik yerleşime dön.
- Servis bağlanınca anahtar alanı gizlenir; **Servise Bağlı** düğmesi pasifleşir. Bağlantı durumunun eski bir yanıtla geri alınması ve başarısız yeni anahtarın çalışan anahtarı silmesi düzeltildi. Saklanan anahtarla **Yeniden bağlan** yapılabilir. Servis yeniden başlatıldığında yeni anahtar gerekir.
- Bağlantı kurulduğunda açık videodaki başarısız başlatma isteği toparlanır. Mevcut işler korunur; servis yeniden başladığı için kaybolmuş hazırlama oturumu yeniden oluşturulur. Bunun için sayfa yenilemek gerekmez.
- **MP3’ler** bölümünde dosyaları topluca seç: en fazla **10 parça**, parça başına **25 MB**. Oynatılabilir dosyaların süresi doğrulanır, aynı içerik tekrar yer kaplamaz. Parçalar otomatik silinmez; tarayıcı kapansa da saklanır. **Dinle**, **İndir** ve **Sil** düğmeleri vardır.
- Video panelinin **Arka plan müziği** bölümünde checkbox ile tek parça seç. Kutuyu kaldırınca müzik kapanır. **Müzik sesi** sürgüsü ayrı düzeyi ayarlar. Seçim sonraki videolarda da hatırlanır. MP3 vokal hazırken çalar; video duraklaması, sarma, hız, ses ve reklam durumunu izler. Kısa parça döngüye girer. İptal, video sonu veya iletişim kesilmesinde durur.
- MP3’ler mevcut vokal arşivinden ayrı tutulur. Yerel servis ya da internete MP3 yüklenmez. Eklentiyi kaldırmak veya eklenti verilerini temizlemek her iki kitaplığı da siler.

**Güncelleme:** Mevcut `Perde-2.2.4/Perde-2.2.2/eklenti` klasöründeki eklentiyi tarayıcının Eklentiler sayfasından **Yenile**; açık YouTube sayfasını bu güncellemeyi yüklemek için bir kez yenile. Kayıtları korumak için eklentiyi kaldırma ve klasörünü değiştirme. Bu sürüm için ses servisinde yeniden kurulum gerekmez.

Bu paket hazır bir şarkı içermez. Kendi MP3 dosyalarını kitaplığa ekleyebilirsin.

## 15 Ekim 2026 · oynatıcı, arayüz ve işlemci iyileştirmeleri

YouTube'un ilerleme çubuğunu, ses düğmesini ve ayarlarını videonun arkasına düşüren katman kuralı kaldırıldı. Maske kendi videosunun katmanını izler; oynatıcının menülerine ve kontrol simgelerine müdahale edilmez. Ölçeklenmiş oynatıcılarda maske hizası düzeltildi. Gizli görseller/video kareleri için gereksiz analiz yapılmaz. Diğer siteler için **Koruma → Diğer sitelerde kullan** bölümünden izin verilir.

Panel **Koruma / Vokaller / Ayarlar** bölümlerine ayrıldı. Klavye ile sekmeler arasında geçilebilir; toplu vokal silme işlemi ayrıca onaylanır. **Vokaller → Yeni vokal hazırla** bölümünde servis bağlantısının gerçek durumu gösterilir. Video üzerindeki vokal kutusu oynatma çubuğundan uzak konumlanır; tam ekranda da erişilebilir, kapalıyken ilerlemeyi veya oynatma durumunu gösterir.

Ses işçisi bu bilgisayarda en fazla 4 CPU iş parçacığı ve düşük işlem önceliğiyle çalışır. Model ve kalite ayarları değişmedi. İki kısa gerçek Demucs ölçümünde ortalama hazırlama süresi yaklaşık %10, toplam CPU zamanı %29 azaldı; bu sonuç 40 dakikalık videoya hız garantisi değildir. Tepe işçi belleği yaklaşık 1,66 GB idi; bilgisayarın toplam kullanımı farklıdır. Ayrıntılar ve ölçüm yöntemi `TEST-SONUCLARI.md` dosyasında.

Güncellemeyi etkinleştirmek için mevcut eklentiyi **Yenile**, YouTube sekmesini yenile ve açık ses servisini kapatıp bu klasördeki **vocal-service/BASLAT.cmd** ile yeniden başlat. Yeni anahtarı **Vokaller → Yeni vokal hazırla** bölümüne bağla. Kayıtlarını korumak için eklentiyi kaldırma.

## 14 Ekim 2026 · tarayıcıdaki vokal kütüphanesi

**Vokali tarayıcıda sakla** kutusu varsayılan olarak açıktır; seçimin sonraki videolar için hatırlanır. Sesin tamamı alındıktan sonra eklentinin bu tarayıcı profilindeki kalıcı alanına kaydedilir. Paneldeki **Kaydedilmiş vokaller** bölümünde videoları, sürelerini ve kapladıkları alanı görebilir; videoyu açabilir, tek kaydı veya bütün tarayıcı kayıtlarını silebilirsin.

Aynı videoyu açınca veya sayfayı yenileyince kayıtlı vokal otomatik yüklenir; **Vokal oluştur** yerine kayıtlı sesin durumu görünür. Kayıtlı sesi kullanmak için yerel servis ve anahtar gerekmez. Yeni vokal hazırlamak için servis gereklidir. Kaydetme kutusunu kapatmak mevcut kaydı silmez. Önceki sürümün `vocal-service/.saved-vocals` klasöründeki kayıt, güncel servis bağlıyken ilgili video açılınca tarayıcıya aktarılır. Yeni kayıtlar tarayıcı kütüphanesine yazılır; eski disk kopyaları paneldeki ayrı düğmeyle silinir.

Kayıtlar eklentiye ve tarayıcı profiline bağlıdır. Güncellerken mevcut eklentinin **Yenile** düğmesini kullan; kaldırıp yeniden kurmak veya eklenti verilerini temizlemek kayıtları siler. Tarayıcıyı kapatmak ya da video sayfasını yenilemek kayıtları silmez. Alan dolarsa veya kayıt başarısız olursa vokal kutusu bunu bildirir.

## 13 Ekim 2026 iyileştirmeleri

- Uzun videolarda ayırma sonrası ses artık tek bir 30 saniyelik istekte alınmaz. 1 MiB parçalar aktarılır; hatalı parça üç kez denenir. İşlem ekranı aktarım ilerlemesini ayrı gösterir. Devam eden hata için **Hazır sesi / bağlantıyı yeniden dene** düğmesi vardır; mevcut iş ve alınmış parçalar korunur. Tarayıcının arka plan belgesi kapanırsa kayıtlı ses tarayıcı kütüphanesinden, geçici ses ise yerel serviste hâlâ bulunuyorsa oradan yeniden alınır; yeniden ayırma yapılmaz.

Güncelleme: eklentiyi yenile, YouTube sekmesini yenile, yerel servisi kapatıp `vocal-service/BASLAT.cmd` ile yeniden aç ve yeni anahtarı bağla. Eklenti ile servis birlikte güncellenmelidir. Eski sürümün zaten silmiş olduğu sesler geri getirilemez.

## Kullanım

1. `chrome://extensions` veya `brave://extensions` sayfasında geliştirici modunu aç. `Paketlenmemiş öğe yükle` ile bu paketin `eklenti` klasörünü seç. Zaten yüklüyse Yenile'ye bas; YouTube sekmelerini de yenile.
2. Eklenti panelinde `Model testi` ile insan + yüz modellerinin hazır olduğunu kontrol et. `Kendi dosyanla test et` sayfası seçilen dosyayı cihazda inceler.
3. Gevşek, dengeli veya yüksek profili seç. İnsan maskeleme, reklam sesi ve kumar filtresi ayrı ayrı açılıp kapanır.
4. YouTube dışındaki bir sitede eklenti panelini açıp `Bu sitede korumayı aç` düğmesini kullan. İzin yalnızca o siteye verilir. İzin verilen siteleri aynı panelden kaldırabilirsin. İzni kaldırıp tekrar eklediğinde sayfayı yenile.

## Yerel vokal

Bu bilgisayarda `vocal-service/.venv` ortamı kuruldu. Sonraki açılışlarda **vocal-service/BASLAT.cmd** dosyasına çift tıkla. Eklenti kimliğini gir; gösterilen oturum anahtarını eklenti panelindeki `Vokaller → Yeni vokal hazırla` bölümüne yapıştır ve bağlan. Anahtarı kimseyle paylaşma.

Paneldeki **Servis bağlantısını kapat** düğmesi anahtarı siler ve tamamlanmamış hazırlama veya aktarımı iptal eder. Tarayıcıya tamamen yüklenmiş vokal çalmaya devam eder; kalıcı kayıtlar silinmez.

Başka bilgisayarda ilk kurulum için Python 3.12 ve Node.js 22+ gerekir. `vocal-service/BASLAT.cmd` çalıştırılır; eksik ses bileşenlerini otomatik kurar. Bu, ayrı bir Python ortamına CPU PyTorch, Demucs, yt-dlp ve FFmpeg kurar; ilk indirme büyüktür. Güvenlik yazılımını veya bilgisayarın genel PowerShell ilkesini kapatmak gerekmez. CUDA sunucusuna taşınırken uygun PyTorch kurulumu ve `server.py --extension-id KIMLIK --device cuda` kullanılabilir. Mevcut servis yalnızca 127.0.0.1'e bağlanır; internete açılan bir API değildir.

YouTube videosunda sağ alttaki `Perde · Vokal` kutusunu kullan. Kayıtlı vokal varsa otomatik yüklenir. Kayıt yoksa `Vokal oluştur` videoyu duraklatır ve mevcut sesi kapatır. Yeni ses hazırlanınca `Vokal ile oynat` ile devam et. Sarma, duraklatma, hız, ses yüksekliği, reklam, video değişimi ve sekme kapanışı hesaba katılır. Vokali susturmak için kutudaki ayrı ses düğmesini kullan. Asıl videonun sessiz durumu vokal açıkken kilitlidir; iptal edilince önceki sessiz durumu geri gelir. İptal videoyu kendiliğinden oynatmaz.

- Aynı anda bir vokal oturumu. Süre sınırı 3, 5, 10, 15, 25 veya **40 dakika**; sunucuda da doğrulanır. Yeni kurulumun varsayılanı 40 dakikadır. Eski ayarlar korunur; mevcut kurulumda panelden 40 dakikayı seç.
- Canlı yayınlar, giriş/yaş doğrulaması/DRM gerektiren videolar ve erişimi kısıtlanan indirmeler desteklenmez. Tarayıcı çerezleri okunmaz.
- İşlem CPU'da 1–2 dakikadan uzun sürebilir. İlk model indirmesi ayrıca zaman alır. 120 dakikadan uzun veya 10 dakikadır ilerlemeyen iş sonlandırılır ve geçici sesleri temizlenir.
- Ses ayırma modelleri konuşma ile şarkı sözünü ayırt etmez: ikisi de vokalde kalabilir; müziği kusursuz kaldırma garantisi yoktur.
- YouTube'un erişim kuralları, ses parçaları ve reklam düzeni değişebilir. Servisin erişemediği ses parçaları seçilemez.

## Türkçe ses tercihi

Türkçe dublaj veya Türkçe orijinal ses erişilebiliyorsa vokal oluşturma otomatik olarak o parçayı kullanır. İngilizce orijinal ses daha yüksek kalitede olsa bile Türkçe önceliklidir. Türkçe parçalar arasında indiricinin kalite sıralaması kullanılır; normal Türkçe ses varsa betimlemeli sesin önüne geçer.

Vokal kutusunda **“Türkçe ses kullanılıyor.”** bilgisi görünür. Türkçe parçaya ulaşılamazsa mevcut sesle devam edilir ve **“Türkçe ses parçasına ulaşılamadı; mevcut ses kullanılıyor.”** bilgisi gösterilir. Türkçe altyazı bulunması ses dublajı sayılmaz; otomatik çeviri veya yeni dublaj üretilmez. Bu tercih YouTube oynatıcısında seçili dilden bağımsızdır.

Güncellemeden sonra eklentiyi yenile, YouTube sekmesini yenile, yerel servisi yeniden başlat ve yeni anahtarı bağla. Daha önce kaydedilmiş farklı dildeki vokal kendiliğinden yeniden hazırlanmaz; iptal etmek kaydı silmez.

Dil tercihi, YouTube ses parçasının `language` bilgisine dayanır; video başlığına veya altyazıya dayanmaz. İndirme, aynı çıkarımda seçilen sesle yapılır. Kaynak: [yt-dlp biçim seçimi](https://github.com/yt-dlp/yt-dlp#format-selection), [YouTube ses dili çıkarımı](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/youtube/_video.py).

## 40 dakikalık video desteği

Sesin tamamı belleğe yüklenmez. 30 saniyelik bloklar 2 saniye örtüşerek işlenir; geçişler tamamlayıcı kosinüs ağırlıklarıyla birleştirilir. Model bir kez yüklenir, sadece mevcut blok ve kısa geçiş bölgesi bellekte kalır. Demucs kendi kısa analiz pencerelerini bu blokların içinde kullanır. Normalizasyon istatistikleri sesin tümü üzerinden akış halinde hesaplanır. Çıktı örnek sayısı dosyanın sonunda doğrulanır.

Vokal kutusunda indirme ve ayırma ilerlemesi gösterilir. Ayırma sırasında geçen süreden kalan süre tahmini hesaplanır; bu bir garanti değildir. MP3 hazırlanması ayrı aşamadır. Sunucu, ilerlemesi durmuş işler için dosya temizleme ve açıklayıcı hata uygular. Kullanım bildirimi, medya senkronizasyonu kuyruğunu bekletmez.

Güncellemeden sonra eklentiyi, YouTube sekmelerini ve yerel servisi yeniden başlat. Yeni servis anahtarını panele bağla. Ses ayırma kalitesi ve işlem süresi içerik/donanıma bağlıdır; 25 dakikaya izin verilmesi 1–2 dakikada hazırlanacağı anlamına gelmez.

16 GB RAM ve Ryzen 5 5500 ile CPU üzerinde kullanım uygundur. Önceki gerçek 25 dakikalık model testinde ses işçisi en fazla 1,93 GB bellek kullandı; 40 dakika için de aynı 30 saniyelik bloklar kullanılır. Bu değer tüm tarayıcının veya bilgisayarın toplam belleği değildir. Önceki 26 dakika 56 saniyelik hazırlama ölçümünden 40 dakika için yaklaşık 43 dakika hesaplanır; bu bir tahmindir, gerçek içerik ve bilgisayar yükü süreyi değiştirebilir.

40 dakika için indirme sınırı 160 MB, dönüşüm/kodlama adımı sınırı 5 dakika, toplam hazırlama sınırı 120 dakikadır. 10 dakika ilerlemeyen işlem yine sonlandırılır. Geçici WAV dosyaları diskte tutulur; yaklaşık 2 GB boş disk alanı bırakılması önerilir. Hazır 192 kbit/sn vokal yaklaşık 57,6 MB olur. Blok işleme yaklaşımı: [Demucs belgeleri](https://github.com/facebookresearch/demucs#separating-tracks).

## Mahremiyet ve güvenlik

Görsel kareler uzaktaki bir analiz servisine gönderilmez. Modeller ve JavaScript dosyaları pakettedir; görüntü analizi yereldir. Gerekirse izin verilen görsel adresi çerezsiz ve önbelleksiz okunur; yönlendirmeler takip edilmez. Görsel kaynak için izin yoksa görsel bulanık kalır.

Hesap veya telemetri yoktur. Ayarlar ve izin verdiğin site listesi tarayıcıda saklanır. Tarayıcıdaki vokal kütüphanesi kaydettiğin videoların kimliklerini, başlıklarını, sürelerini ve seslerini eklentinin yerel verilerinde tutar. Eski servis kayıtları ayrıca `vocal-service/.saved-vocals` klasöründe bulunabilir; bunlar paneldeki ayrı düğmeyle silinir. Vokal servis anahtarı ve etkin iş kimliği yalnızca tarayıcı oturum belleğindedir; içerik betiklerine açılmaz. Tanılama kopyası sayfa adresi ve video kimliği içermez.

Vokal isteğinde video kimliği bu bilgisayardaki servise gönderilir; servis YouTube'dan sesi indirir. Bu, YouTube'a normal ağ erişimidir. Demucs'un ilk çalışmasında resmi model dosyası indirilir. İndirilen kaynak ses işlem bittiğinde/hata verdiğinde silinir. Servisteki geçici hazır vokal oturum kapanınca, iptal edilince veya sunucuda 15 dakika kullanılmayınca temizlenir. Kaydetme açıksa tamamlanan ses tarayıcıdaki kalıcı kütüphaneye yazılır; sayfayı yenilemek veya tarayıcıyı kapatmak bu kaydı silmez. Ses hazırlanırken veya aktarılırken kullanım bildirimi geçici işin canlı kalmasını sağlar. Sesin tamamı tarayıcıya yüklendikten sonra oynatma yerel servise bağlı değildir. Normal servis kapanışı geçici işleri temizler; tarayıcıdaki kayıtları ve önceki sürümden kalan disk kayıtlarını silmez. Zorla kapatma/elektrik kesintisinde geçici dosyalar bir sonraki servis açılışında temizlenir; bu yüzden mutlak "hiçbir zaman diske veri yazılmaz" iddiası yoktur. Model ağırlıkları kişisel veri değildir ve tekrar indirmemek için saklanır.

Servis yalnızca yerel adresi dinler; oturum anahtarı, Host/Origin kontrolü, sabit YouTube kimliği biçimi, süre/boyut/iş sayısı sınırı ve kabuksuz işlem çağrısı kullanır. Sayfalara anahtar aktarılmaz; vokal tarayıcının eklenti belgesinde oynar. Uzantı güvenlik politikasına `unsafe-eval` eklenmemiştir. Bunlar bağımsız bir güvenlik denetimi veya hatasızlık garantisi değildir.

Başlat penceresini kapatmak devam eden vokal işlemini iptal eder. Windows ses işçilerini de kapatır; servis yeniden açıldığında önceki geçici sesleri temizler. Kısa süreli dosya kilidi kalırsa servis açılır ve temizliği 20 saniyede bir yeniden dener. Yeniden açtıktan sonra yeni oturum anahtarını eklentiye bağla. Tarayıcıya kaydedilmiş bir vokal aynı video açıldığında otomatik kullanılır.

## Görsel ve reklam sınırları

- Görsel motor bütün insanları hedefler. İnsan algılama yanlış pozitif/negatif üretebilir. Hızlı hareket ve sahne değişiminde kısa açık kareler olabilir.
- Analiz beklerken/okunamayan görseller bulanık kalır. Varsayılan olarak analiz hatasında video duraklar. Koruma seviyesi garanti değil, hassasiyet ve maske payıdır.
- Normal `img` ve `video` öğeleri hedeflenir. CSS arka planları, canvas/WebGL, kapalı shadow DOM, animasyonların bütün kareleri, DRM ve bazı çapraz kaynak videoları kapsam dışındadır.
- YouTube reklam susturma, oynatıcının reklam işaretlerini izler. Video içine gömülmüş sponsor konuşmalarını veya tüm sitelerin reklamlarını otomatik tanımaz.
- Kumar filtresi yalnızca tanınan reklam kutularında sınırlı Türkçe/İngilizce ifadeler ve alan adı kuralları kullanır. Genel bir kumar sınıflandırıcısı değildir; eksik/yanlış eşleşebilir.
- YouTube oynatıcısının tam ekranını kullan. Video öğesinin tek başına tam ekranı ve ayrı görüntü-içinde-görüntü penceresi maske katmanını taşıyamadığı için insan koruması açıkken engellenir.

## Geliştirme ve doğrulama

Güncel değişikliklerin kapsamı ve doğrulama sınırları `TEST-SONUCLARI.md` başında yer alır. `python tests/test_service_inprocess.py` servis ve kayıt davranışını ağ bağlantısı açmadan doğrular.


- `node --test tests/*.test.cjs`: ayar sınırları, video kimliği, maske takibi, servis erişimi, vokal oturum sahipliği ve ses zamanlama yaşam döngüsü.
- `python tests/test_service.py`: HTTP yetkilendirme, kaynak kontrolü, süre ve canlı yayın reddi, tek iş sınırı, iptal ve süresi dolan dosyaların temizlenmesi.
- `node tests/browser-smoke.cjs`: ayrı Brave profiliyle gerçek Manifest V3 eklentisi ve yerel model başlatma. Test için Playwright gerekir; ortam yolu test dosyasında ayarlanır.
- `.venv/Scripts/python tests/demucs-smoke.py` (paket kökünden `vocal-service/.venv/Scripts/python.exe`): yapay kısa sesle gerçek Demucs çalıştırma ve örnek sayısının korunması; algısal kalite testi değildir.

- `vocal-service/.venv/Scripts/python.exe tests/test_audio_stream.py`: blok sınırları, örnek doğruluğu ve 40 dakikalık akışta sınırlı blok boyutu.
- `node tests/browser-audio-integration.cjs`: ayrı profilde gerçek eklenti → yetkili yerel HTTP → gerçek offscreen ses oynatma. Servis yapay ses verir; test kopyasına yerel sunucu izni önceden eklenir. Asıl eklenti dosyaları değişmez.
- `node tests/browser-controls.cjs`: 40 dakikalık medya, ilerleme göstergesi, oturum bildirimi, geç zamana sarma ve reklam senaryoları (taklit servis).
- `vocal-service/.venv/Scripts/python.exe tests/demucs-long-smoke.py`: 25 dakikalık yapay sesle gerçek Demucs ve MP3 kodlama/çözme sonrası örnek sayısı. Sonuç `tests/long-audio-result.json` dosyasına yazılır. Kişisel dosya kullanılmaz; geçici sesler test sonunda silinir.

- `vocal-service/.venv/Scripts/python.exe tests/test_audio_selection.py`: Türkçe dil önceliği, ses dili varyantları ve gerçek yt-dlp/FFmpeg ile yerel çok dilli ses indirme; Demucs bu testte taklittir.
- `vocal-service/.venv/Scripts/python.exe tests/turkish-track-smoke.py VIDEO_KIMLIGI`: isteğe bağlı ağ testi; gerçek Türkçe ses parçasını indirir, kısa bölümü çözer ve geçici sesleri siler.

- `vocal-service/.venv/Scripts/python.exe tests/test_reliability.py` ve `tests/test_streaming.py`: durum dosyası yarışı, işçi kapanışı, hata mesajları, büyüyen MP3’ün servis edilmesi, oynatma konumu bildirimi ve kodlayıcı gecikmesi.
- `node tests/browser-stream-real.cjs [VIDEO_KIMLIGI] [SANIYE]`: gerçek servis ve gerçek YouTube sesiyle izlerken hazırlama; ilk oynatma süresi, senkron, bekleme/devam ve geri sarma ölçülür. Ağ ve servis ortamı gerekir.
- `vocal-service/.venv/Scripts/python.exe tests/long-media-smoke.py`: 40 dakikalık 44.100 Hz stereo WAV akışı ve gerçek MP3 kodlama/çözme; model yerine kimlik dönüşümü kullanılır, tam Demucs hız testi değildir.

Orijinal üçüncü taraf görüntü kütüphaneleri değiştirilmedi. TensorFlow paketinin strict-mode regenerator globalini önce bildiren `vendor-compat.js`, Manifest V3 güvenlik politikasını gevşetmeden yükleme hatasını giderir.

MDX-Net modeli [Ultimate Vocal Remover model deposundan](https://github.com/TRvlvr/model_repo) indirilir; ONNX Runtime DirectML ile çalışır.

Kaynaklar: [Chrome izinleri](https://developer.chrome.com/docs/extensions/reference/api/permissions), [içerik betikleri](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Demucs](https://github.com/facebookresearch/demucs), [yt-dlp](https://github.com/yt-dlp/yt-dlp). TensorFlow.js, COCO-SSD ve BlazeFace lisansları `eklenti/vendor` klasöründe; bağımlılıkların kendi lisansları geçerlidir.
