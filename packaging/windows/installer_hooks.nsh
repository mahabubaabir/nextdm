!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering NextDM browser integration..."
  ExecWait '"$INSTDIR\NextDM.exe" --register-native-host'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing NextDM browser integration registry keys..."
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.nextdm.host"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.nextdm.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.nextdm.host"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.nextdm.host"
  DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.nextdm.host"
!macroend
