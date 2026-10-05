// Captura todo o som do Windows, exceto o do Discord (process loopback, Windows 10 2004+).
// Escreve PCM s16le, 2 canais, 48 kHz no stdout. Termina quando o stdin fecha (o app saiu).
// Uso: audio-capture.exe [--exclude <pid>]
// Compilar: npm run native

#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <tlhelp32.h>
#include <wrl/implements.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <map>
#include <string>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

static volatile bool g_quit = false;

class ActivationHandler
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
    ComPtr<IUnknown> unknown;
    HRESULT hr = operation->GetActivateResult(&result, &unknown);
    if (SUCCEEDED(hr) && SUCCEEDED(result)) result = unknown.As(&client);
    else if (FAILED(hr)) result = hr;
    SetEvent(done);
    return S_OK;
  }
};

// Processo raiz do Discord (o pai tem outro nome); a exclusão vale para a árvore toda.
static DWORD FindDiscord(std::wstring& name) {
  static const wchar_t* names[] = {L"Discord.exe", L"DiscordPTB.exe", L"DiscordCanary.exe", L"DiscordDevelopment.exe"};
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return 0;

  std::map<DWORD, PROCESSENTRY32W> processes;
  PROCESSENTRY32W entry = {sizeof(entry)};
  for (BOOL ok = Process32FirstW(snapshot, &entry); ok; ok = Process32NextW(snapshot, &entry)) {
    processes[entry.th32ProcessID] = entry;
  }
  CloseHandle(snapshot);

  for (const wchar_t* target : names) {
    for (const auto& [pid, process] : processes) {
      if (_wcsicmp(process.szExeFile, target) != 0) continue;
      auto parent = processes.find(process.th32ParentProcessID);
      if (parent != processes.end() && _wcsicmp(parent->second.szExeFile, target) == 0) continue;
      name = target;
      return pid;
    }
  }
  return 0;
}

static DWORD WINAPI WatchStdin(LPVOID) {
  char buffer[256];
  DWORD read = 0;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(input, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
  }
  g_quit = true;
  return 0;
}

static int Fail(const char* step, HRESULT hr) {
  fprintf(stderr, "%s falhou (0x%08lx)\n", step, static_cast<unsigned long>(hr));
  return 1;
}

int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdout), _O_BINARY);

  DWORD pid = 0;
  std::wstring name = L"(manual)";
  for (int i = 1; i + 1 < argc; i++) {
    if (wcscmp(argv[i], L"--exclude") == 0) pid = wcstoul(argv[i + 1], nullptr, 10);
  }
  if (!pid) pid = FindDiscord(name);
  if (!pid) {
    // Sem Discord aberto: excluir a si mesmo (que não toca nada) equivale a capturar tudo.
    pid = GetCurrentProcessId();
    name = L"nenhum Discord aberto";
  }
  fwprintf(stderr, L"excluindo pid %lu (%ls)\n", pid, name.c_str());

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail("CoInitializeEx", hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  params.ProcessLoopbackParams.TargetProcessId = pid;

  PROPVARIANT activation = {};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(params);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ComPtr<ActivationHandler> handler = Make<ActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &activation,
                                   handler.Get(), &operation);
  if (FAILED(hr)) return Fail("ActivateAudioInterfaceAsync", hr);
  WaitForSingleObject(handler->done, INFINITE);
  if (FAILED(handler->result)) return Fail("Ativação do process loopback", handler->result);
  ComPtr<IAudioClient> client = handler->client;

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                          200000, 0, &format, nullptr);
  if (FAILED(hr)) return Fail("IAudioClient::Initialize", hr);

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(ready);
  if (FAILED(hr)) return Fail("SetEventHandle", hr);

  ComPtr<IAudioCaptureClient> capture;
  hr = client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr)) return Fail("GetService", hr);

  CreateThread(nullptr, 0, WatchStdin, nullptr, 0, nullptr);

  hr = client->Start();
  if (FAILED(hr)) return Fail("IAudioClient::Start", hr);

  static BYTE silence[48000 * 4];
  while (!g_quit) {
    if (WaitForSingleObject(ready, 100) != WAIT_OBJECT_0) continue;

    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;

      size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
      const void* source = (flags & AUDCLNT_BUFFERFLAGS_SILENT) && bytes <= sizeof(silence) ? silence : data;
      bool written = fwrite(source, 1, bytes, stdout) == bytes;
      capture->ReleaseBuffer(frames);
      if (!written) {
        g_quit = true;
        break;
      }
    }
    fflush(stdout);
  }

  client->Stop();
  return 0;
}
