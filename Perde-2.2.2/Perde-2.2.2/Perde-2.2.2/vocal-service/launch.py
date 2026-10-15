from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent
print('Chrome/Brave > Eklentiler > Geliştirici modu > Perde kimliği')
extension_id=input('32 harfli eklenti kimliğini yapıştır: ').strip()
sys.argv=[str(ROOT/'server.py'),'--extension-id',extension_id]
from server import main
try:main()
except Exception as error:
    print('Servis başlatılamadı:',error)
    raise SystemExit(1)
