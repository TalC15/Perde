# Perde 2.2.2 — çalışma notu

HAKKINDA.txt değiştirilmedi. İnsan ve yüz algılama yereldir. **Cinsiyet otomatik tahmin edilmez.** İsteğe bağlı sansür, kullanıcının elle verdiği erkek / erkek olmayan etiketlerini kullanır; etiketsiz kişiler örtülür.

## 13 Ekim 2026 iyileştirmeleri

- Uzun videolarda ayırma sonrası ses artık tek bir 30 saniyelik istekte alınmaz. 1 MiB parçalar aktarılır; hatalı parça üç kez denenir. İşlem ekranı aktarım ilerlemesini ayrı gösterir. Devam eden hata için **Hazır sesi / bağlantıyı yeniden dene** düğmesi vardır; mevcut iş ve alınmış parçalar korunur. Tarayıcının arka plan belgesi kapanırsa hazır dosya yerel servisten yeniden alınır; Demucs yeniden çalışmaz.
- Vokal kutusundaki **Vokali bu bilgisayarda sakla** işaretlenirse tamamlanan MP3 ve doğrulama bilgisi `vocal-service/.saved-vocals` içinde tutulur. Sonradan hazır bir ses için de işaretlenebilir. Varsayılan kapalıdır ve seçim video başınadır. Aynı video için **Vokal oluştur** düğmesine tekrar basıldığında kayıt varsa ayırma yapılmadan yüklenir. Servis kapansa da kayıt kalır; yeni servis anahtarını bağlamak gerekir. Kutu işaretini kaldırmak mevcut kaydı silmez. Panelde **Kaydedilmiş tüm vokalleri sil** düğmesi vardır. Kayıtlar otomatik olarak sona ermez; 40 dakikalık bir MP3 yaklaşık 58 MB tutabilir.
- Panelde **Kimler örtülsün?**: tüm insanlar, erkek olarak etiketlediklerim, erkek olmayan olarak etiketlediklerim. **Kişileri elle etiketle** videoyu duraklatır ve kutuların içini gösterir; etiketleri seçip **Etiketlemeyi bitir** düğmesine bas. Etiketler kişi takibi sırasında kullanılır, diske yazılmaz. Takip kaybı, sarma, yeni video ve belirgin sahne değişiminde sıfırlanır. Bu bir kimlik tanıma sistemi değildir; kesmeler, örtüşmeler ve benzer konumlar takibi karıştırabilir. Etiketsiz kişiler her seçimde örtülür.

Güncelleme: eklentiyi yenile, YouTube sekmesini yenile, yerel servisi kapatıp `vocal-service/BASLAT.cmd` ile yeniden aç ve yeni anahtarı bağla. Eklenti ile servis birlikte güncellenmelidir. Eski sürümün zaten silmiş olduğu sesler geri getirilemez.

## Kullanım

1. `chrome://extensions` veya `brave://extensions` sayfasında geliştirici modunu aç. `Paketlenmemiş öğe yükle` ile bu paketin `eklenti` klasörünü seç. Zaten yüklüyse Yenile'ye bas; YouTube sekmelerini de yenile.
2. Eklenti panelinde `Model testi` ile insan + yüz modellerinin hazır olduğunu kontrol et. `Kendi dosyanla test et` sayfası seçilen dosyayı cihazda inceler.
3. Gevşek, dengeli veya yüksek profili seç. İnsan maskeleme, reklam sesi ve kumar filtresi ayrı ayrı açılıp kapanır.
4. YouTube dışındaki bir sitede eklenti panelini açıp `Bu sitede korumayı aç` düğmesini kullan. İzin yalnızca o siteye verilir. İzin verilen siteleri aynı panelden kaldırabilirsin. İzni kaldırıp tekrar eklediğinde sayfayı yenile.

## Yerel vokal

Bu bilgisayarda `vocal-service/.venv` ortamı kuruldu. Sonraki açılışlarda **vocal-service/BASLAT.cmd** dosyasına çift tıkla. Eklenti kimliğini gir; gösterilen oturum anahtarını eklenti panelindeki `Yerel vokal servisi` bölümüne yapıştır ve bağlan. Anahtarı kimseyle paylaşma.

Başka bilgisayarda ilk kurulum için Python 3.12 ve Node.js 22+ gerekir. `vocal-service/BASLAT.cmd` çalıştırılır; eksik ses bileşenlerini otomatik kurar. Bu, ayrı bir Python ortamına CPU PyTorch, Demucs, yt-dlp ve FFmpeg kurar; ilk indirme büyüktür. Güvenlik yazılımını veya bilgisayarın genel PowerShell ilkesini kapatmak gerekmez. CUDA sunucusuna taşınırken uygun PyTorch kurulumu ve `server.py --extension-id KIMLIK --device cuda` kullanılabilir. Mevcut servis yalnızca 127.0.0.1'e bağlanır; internete açılan bir API değildir.

YouTube videosunda sağ alttaki `Perde · Vokal` kutusunu aç. `Vokal oluştur` videoyu duraklatır ve mevcut sesi kapatır. Hazırlanınca `Vokal ile oynat` ile devam et. Sarma, duraklatma, hız, ses yüksekliği, reklam, video değişimi ve sekme kapanışı hesaba katılır. Vokali susturmak için kutudaki ayrı ses düğmesini kullan. Asıl videonun sessiz durumu vokal açıkken kilitlidir; iptal edilince önceki sessiz durumu geri gelir. İptal videoyu kendiliğinden oynatmaz.

- Aynı anda bir vokal oturumu. Süre sınırı 3, 5, 10, 15, 25 veya **40 dakika**; sunucuda da doğrulanır. Yeni kurulumun varsayılanı 40 dakikadır. Eski ayarlar korunur; mevcut kurulumda panelden 40 dakikayı seç.
- Canlı yayınlar, giriş/yaş doğrulaması/DRM gerektiren videolar ve erişimi kısıtlanan indirmeler desteklenmez. Tarayıcı çerezleri okunmaz.
- İşlem CPU'da 1–2 dakikadan uzun sürebilir. İlk model indirmesi ayrıca zaman alır. 120 dakikadan uzun veya 10 dakikadır ilerlemeyen iş sonlandırılır ve geçici sesleri temizlenir.
- Demucs konuşma ile şarkı sözünü ayırt etmez: ikisi de vokalde kalabilir; müziği kusursuz kaldırma garantisi yoktur.
- YouTube'un erişim kuralları, ses parçaları ve reklam düzeni değişebilir. Servisin erişemediği ses parçaları seçilemez.

## Türkçe ses tercihi

Türkçe dublaj veya Türkçe orijinal ses erişilebiliyorsa vokal oluşturma otomatik olarak o parçayı kullanır. İngilizce orijinal ses daha yüksek kalitede olsa bile Türkçe önceliklidir. Türkçe parçalar arasında indiricinin kalite sıralaması kullanılır; normal Türkçe ses varsa betimlemeli sesin önüne geçer.

Vokal kutusunda **“Türkçe ses kullanılıyor.”** bilgisi görünür. Türkçe parçaya ulaşılamazsa mevcut sesle devam edilir ve **“Türkçe ses parçasına ulaşılamadı; mevcut ses kullanılıyor.”** bilgisi gösterilir. Türkçe altyazı bulunması ses dublajı sayılmaz; otomatik çeviri veya yeni dublaj üretilmez. Bu tercih YouTube oynatıcısında seçili dilden bağımsızdır.

Güncellemeden sonra eklentiyi yenile, YouTube sekmesini yenile, yerel servisi yeniden başlat ve yeni anahtarı bağla. Daha önce hazırlanmış farklı dildeki vokali iptal edip yeniden oluştur.

Dil tercihi, YouTube ses parçasının `language` bilgisine dayanır; video başlığına veya altyazıya dayanmaz. İndirme, aynı çıkarımda seçilen sesle yapılır. Kaynak: [yt-dlp biçim seçimi](https://github.com/yt-dlp/yt-dlp#format-selection), [YouTube ses dili çıkarımı](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/youtube/_video.py).

## 40 dakikalık video desteği

Sesin tamamı belleğe yüklenmez. 30 saniyelik bloklar 2 saniye örtüşerek işlenir; geçişler tamamlayıcı kosinüs ağırlıklarıyla birleştirilir. Model bir kez yüklenir, sadece mevcut blok ve kısa geçiş bölgesi bellekte kalır. Demucs kendi kısa analiz pencerelerini bu blokların içinde kullanır. Normalizasyon istatistikleri sesin tümü üzerinden akış halinde hesaplanır. Çıktı örnek sayısı dosyanın sonunda doğrulanır.

Vokal kutusunda indirme ve ayırma ilerlemesi gösterilir. Ayırma sırasında geçen süreden kalan süre tahmini hesaplanır; bu bir garanti değildir. MP3 hazırlanması ayrı aşamadır. Sunucu, ilerlemesi durmuş işler için dosya temizleme ve açıklayıcı hata uygular. Kullanım bildirimi, medya senkronizasyonu kuyruğunu bekletmez.

Güncellemeden sonra eklentiyi, YouTube sekmelerini ve yerel servisi yeniden başlat. Yeni servis anahtarını panele bağla. Ses ayırma kalitesi ve işlem süresi içerik/donanıma bağlıdır; 25 dakikaya izin verilmesi 1–2 dakikada hazırlanacağı anlamına gelmez.

16 GB RAM ve Ryzen 5 5500 ile CPU üzerinde kullanım uygundur. Önceki gerçek 25 dakikalık model testinde ses işçisi en fazla 1,93 GB bellek kullandı; 40 dakika için de aynı 30 saniyelik bloklar kullanılır. Bu değer tüm tarayıcının veya bilgisayarın toplam belleği değildir. Önceki 26 dakika 56 saniyelik hazırlama ölçümünden 40 dakika için yaklaşık 43 dakika hesaplanır; bu bir tahmindir, gerçek içerik ve bilgisayar yükü süreyi değiştirebilir.

40 dakika için indirme sınırı 160 MB, dönüşüm/kodlama adımı sınırı 5 dakika, toplam hazırlama sınırı 120 dakikadır. 10 dakika ilerlemeyen işlem yine sonlandırılır. Geçici WAV dosyaları diskte tutulur; yaklaşık 2 GB boş disk alanı bırakılması önerilir. Hazır 192 kbit/sn vokal yaklaşık 57,6 MB olur. Blok işleme yaklaşımı: [Demucs belgeleri](https://github.com/facebookresearch/demucs#separating-tracks).

## Mahremiyet ve güvenlik

Görsel kareler uzaktaki bir analiz servisine gönderilmez. Modeller ve JavaScript dosyaları pakettedir; görüntü analizi yereldir. Gerekirse izin verilen görsel adresi çerezsiz ve önbelleksiz okunur; yönlendirmeler takip edilmez. Görsel kaynak için izin yoksa görsel bulanık kalır.

Hesap veya telemetri yoktur. Ayarlar ve izin verdiğin site listesi tarayıcıda saklanır. İsteğe bağlı vokal kütüphanesi, kaydettiğin videoların kimliklerini dosya adlarında ve ses dosyalarını bilgisayarında tutar. Vokal servis anahtarı ve etkin iş kimliği yalnızca tarayıcı oturum belleğindedir; içerik betiklerine açılmaz. Tanılama kopyası sayfa adresi ve video kimliği içermez.

Vokal isteğinde video kimliği bu bilgisayardaki servise gönderilir; servis YouTube'dan sesi indirir. Bu, YouTube'a normal ağ erişimidir. Demucs'un ilk çalışmasında resmi model dosyası indirilir. İndirilen kaynak ses işlem bittiğinde/hata verdiğinde silinir. Kaydetme kapalıysa hazır vokal oturum kapanana, iptal edilene veya sunucuda 15 dakika kullanılmayana kadar geçici dosyadır. Kaydetme açıksa ayrıca kalıcı kütüphaneye kopyalanır; o kopya yalnızca sen sildiğinde kaldırılır. Açık vokal oturumu 30 saniyede bir kullanım bildirimi gönderir; uzun videonun ortasında dosya silinmez. Tarayıcıdaki ses kopyası oturum bitene kadar bellekte kalır. Normal servis kapanışı geçici işleri temizler; isteğe bağlı kaydedilmiş vokalleri korur. Zorla kapatma/elektrik kesintisinde geçici dosyalar bir sonraki servis açılışında temizlenir; bu yüzden mutlak "hiçbir zaman diske veri yazılmaz" iddiası yoktur. Model ağırlıkları kişisel veri değildir ve tekrar indirmemek için saklanır.

Servis yalnızca yerel adresi dinler; oturum anahtarı, Host/Origin kontrolü, sabit YouTube kimliği biçimi, süre/boyut/iş sayısı sınırı ve kabuksuz işlem çağrısı kullanır. Sayfalara anahtar aktarılmaz; vokal tarayıcının eklenti belgesinde oynar. Uzantı güvenlik politikasına `unsafe-eval` eklenmemiştir. Bunlar bağımsız bir güvenlik denetimi veya hatasızlık garantisi değildir.

Başlat penceresini kapatmak devam eden vokal işlemini iptal eder. Windows ses işçilerini de kapatır; servis yeniden açıldığında önceki geçici sesleri temizler. Kısa süreli dosya kilidi kalırsa servis açılır ve temizliği 20 saniyede bir yeniden dener. Yeniden açtıktan sonra yeni oturum anahtarını eklentiye bağla. Vokal oluştur düğmesi kayıtlı kopya varsa onu kullanır.

## Görsel ve reklam sınırları

- Cinsiyet otomatik tahmin edilmez; kategori seçimi yalnızca elle verilen etiketlerle çalışır. İnsan algılama yanlış pozitif/negatif üretebilir. Hızlı hareket ve sahne değişiminde kısa açık kareler olabilir.
- Analiz beklerken/okunamayan görseller bulanık kalır. Varsayılan olarak analiz hatasında video duraklar. Koruma seviyesi garanti değil, hassasiyet ve maske payıdır.
- Normal `img` ve `video` öğeleri hedeflenir. CSS arka planları, canvas/WebGL, kapalı shadow DOM, animasyonların bütün kareleri, DRM ve bazı çapraz kaynak videoları kapsam dışındadır.
- YouTube reklam susturma, oynatıcının reklam işaretlerini izler. Video içine gömülmüş sponsor konuşmalarını veya tüm sitelerin reklamlarını otomatik tanımaz.
- Kumar filtresi yalnızca tanınan reklam kutularında sınırlı Türkçe/İngilizce ifadeler ve alan adı kuralları kullanır. Genel bir kumar sınıflandırıcısı değildir; eksik/yanlış eşleşebilir.
- YouTube oynatıcısının tam ekranını kullan. Video öğesinin tek başına tam ekranı ve ayrı görüntü-içinde-görüntü penceresi maske katmanını taşıyamadığı için insan koruması açıkken engellenir.

## Geliştirme ve doğrulama

Yeni değişikliklerin 13 Ekim kapsamı ve çalıştırılamayan gerçek bağlantı testleri `TEST-SONUCLARI.md` başında yer alır. `python tests/test_service_inprocess.py` servis ve kayıt davranışını ağ bağlantısı açmadan doğrular.


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

- `vocal-service/.venv/Scripts/python.exe tests/long-media-smoke.py`: 40 dakikalık 44.100 Hz stereo WAV akışı ve gerçek MP3 kodlama/çözme; model yerine kimlik dönüşümü kullanılır, tam Demucs hız testi değildir.

Orijinal üçüncü taraf görüntü kütüphaneleri değiştirilmedi. TensorFlow paketinin strict-mode regenerator globalini önce bildiren `vendor-compat.js`, Manifest V3 güvenlik politikasını gevşetmeden yükleme hatasını giderir.

Kaynaklar: [Chrome izinleri](https://developer.chrome.com/docs/extensions/reference/api/permissions), [içerik betikleri](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Demucs](https://github.com/facebookresearch/demucs), [yt-dlp](https://github.com/yt-dlp/yt-dlp). TensorFlow.js, COCO-SSD ve BlazeFace lisansları `eklenti/vendor` klasöründe; bağımlılıkların kendi lisansları geçerlidir.
