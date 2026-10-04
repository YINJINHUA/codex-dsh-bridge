$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $target = [IO.Path]::GetFullPath([string]$request.path)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  function No-Reparse([string]$value) {
    $current = $value
    while ($current) {
      if (Test-Path -LiteralPath $current) {
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe_reparse_point' }
      }
      $parent = [IO.Directory]::GetParent($current)
      if ($null -eq $parent) { break }
      $current = $parent.FullName
    }
  }
  function Local-NTFS([string]$value) {
    if ($value.StartsWith('\\')) { throw 'local_ntfs_required' }
    $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($value))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { throw 'local_ntfs_required' }
    No-Reparse $value
  }
  function Private-ACL([string]$value, [bool]$directory) {
    $acl = Get-Acl -LiteralPath $value
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'unsafe_file' }
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
      if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value) { throw 'unsafe_file' }
    }
    if ($directory -and -not (Get-Item -LiteralPath $value -Force).PSIsContainer) { throw 'unsafe_directory' }
  }
  function Trusted-Parents([string]$value) {
    $parent = [IO.Directory]::GetParent($value)
    while ($null -ne $parent) {
      if (Test-Path -LiteralPath $parent.FullName) {
        $acl = Get-Acl -LiteralPath $parent.FullName
        if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'unsafe_directory' }
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
          if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
          $danger = [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
          if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $danger)) { throw 'unsafe_directory' }
        }
      }
      $parent = $parent.Parent
    }
  }
  function Prepare-Directory([string]$value) {
    if (Test-Path -LiteralPath $value) { Private-ACL $value $true; return }
    $parent = [IO.Path]::GetDirectoryName($value)
    if (-not (Test-Path -LiteralPath $parent)) { Prepare-Directory $parent }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [IO.Directory]::CreateDirectory($value, $acl) | Out-Null
    Private-ACL $value $true
  }
  Local-NTFS $target
  Trusted-Parents $target
  switch ($request.action) {
    'prepare' { Prepare-Directory $target }
    'directory' { Private-ACL $target $true }
    'file' {
      if (-not (Test-Path -LiteralPath $target)) { [Console]::Write('{"ok":false,"code":"ENOENT"}'); exit 0 }
      if ((Get-Item -LiteralPath $target -Force).PSIsContainer) { throw 'unsafe_file' }
      Private-ACL $target $false
    }
    'binary' {
      if ([IO.Path]::GetExtension($target) -ne '.exe') { throw 'unsafe_binary' }
      $current = $target
      while ($current) {
        $acl = Get-Acl -LiteralPath $current
        if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'unsafe_binary' }
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
          if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
          $danger = [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
          if ($current -eq $target) { $danger = $danger -bor [Security.AccessControl.FileSystemRights]::Write }
          if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $danger)) { throw 'unsafe_binary' }
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }; $current = $parent.FullName
      }
    }
    'move' {
      Local-NTFS ([string]$request.destination)
      Trusted-Parents ([string]$request.destination)
      Private-ACL ([IO.Path]::GetDirectoryName($target)) $true
      Private-ACL ([IO.Path]::GetDirectoryName([string]$request.destination)) $true
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BridgeMove { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileEx(string from, string to, uint flags); }'
      $created = $false
      try {
        if ($request.PSObject.Properties.Name -contains 'content') {
          if ($request.replace -eq $true -or $request.content -isnot [string] -or $request.content.Length -gt 87384) { throw 'unsafe_file' }
          $bytes = [Convert]::FromBase64String($request.content)
          if ($bytes.Length -gt 65536) { throw 'unsafe_file' }
          $acl = New-Object Security.AccessControl.FileSecurity
          $acl.SetAccessRuleProtection($true, $false)
          $acl.SetOwner($sid)
          $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
          # TokenOwner may be Administrators even when TokenUser is a normal account.
          # Supply the descriptor at CreateNew; never repair an existing file's ACL.
          $stream = [IO.FileStream]::new($target, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write,
            [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough, $acl)
          $created = $true
          try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        }
        Private-ACL $target $false
        $flags = 8; if ($request.replace -eq $true) { $flags = 9 }
        if (-not [BridgeMove]::MoveFileEx($target, [string]$request.destination, $flags)) {
          $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
          if ($errorCode -eq 80 -or $errorCode -eq 183) { [Console]::Write('{"ok":false,"code":"EEXIST"}'); exit 0 }
          throw 'atomic_move_failed'
        }
      } finally {
        if ($created -and [IO.File]::Exists($target)) { [IO.File]::Delete($target) }
      }
    }
    default { throw 'windows_security_unavailable' }
  }
  [Console]::Write('{"ok":true}')
} catch {
  $message = $_.Exception.Message
  if ($message -notmatch '^(unsafe_directory|unsafe_file|unsafe_binary|unsafe_reparse_point|local_ntfs_required|atomic_move_failed)$') { $message = 'windows_security_unavailable' }
  [Console]::Write((@{ok=$false;error=$message} | ConvertTo-Json -Compress))
}
