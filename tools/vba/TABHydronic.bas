Attribute VB_Name = "TABHydronic"
Option Explicit

' ============================================================================
'  a2b Hydronic TAB Report – report assembly macros (revision H01 layout)
'
'  Import once per template copy:  Alt+F11 > File > Import File... > TABHydronic.bas
'  and delete the old "SyncToCPageCounts" module (the ToC button calls the
'  routine of the same name in this module).
'
'  Public entry points (Alt+F8):
'    PrintReport        – hide unused pumps / pages / rows, sync the ToC, export
'                         the whole report to one PDF (or send to the printer)
'    HideUnusedBlocks   – hide pump blocks, valve pages and table rows that hold no data
'    ShowAllBlocks      – undo HideUnusedBlocks
'    SyncToCPageCounts  – rewrite the "page n" cells on the ToC
'
'  Sheet layout assumed (revision H01):
'    Pumps             : 26-row blocks, two per page, "Pump" in B
'    Valves            : one system per page (52 rows), "System" in B, used when D holds a system
'    Plant Equipment   : 52-row pages, table rows anchor+4 .. anchor+43 (unit in B)
'    Flow Measurements : one page, table rows 8 .. 31
'    System Summary    : one line per system from row 7; blank lines hidden
' ============================================================================

Private Const FIRST_ROW As Long = 4
Private Const PAGE_ROWS As Long = 52

Private Function ReportSections() As Variant
    Dim m(0 To 10) As Variant
    m(0) = Array(10, Array("ToC"))
    m(1) = Array(13, Array("Narrative", "Summary - New", "Summary - (E)"))
    m(2) = Array(16, Array("System Summary"))
    m(3) = Array(19, Array("Pumps"))
    m(4) = Array(22, Array("Valves"))
    m(5) = Array(25, Array("Plant Equipment", "Flow Measurements"))
    m(6) = Array(28, Array("Certification", "NEBB Cert", "NEBB Frm Cert"))
    m(7) = Array(31, Array("Abbreviations"))
    m(8) = Array(34, Array("Calibration"))
    m(9) = Array(37, Array())                 ' Piping schematic(s) – attached separately
    m(10) = Array(40, Array("Photos"))
    ReportSections = m
End Function

' ---------------------------------------------------------------------------
Private Function FindSheet(ByVal wb As Workbook, ByVal label As String) As Worksheet
    Dim s As Worksheet, target As String
    target = LCase$(Trim$(label))
    For Each s In wb.Worksheets
        If LCase$(Trim$(s.Name)) = target Then Set FindSheet = s: Exit Function
    Next s
    For Each s In wb.Worksheets
        If Left$(LCase$(Trim$(s.Name)), Len(target)) = target Then Set FindSheet = s: Exit Function
    Next s
    Set FindSheet = Nothing
End Function

Private Function CountPrintPages(ByVal sh As Worksheet) As Long
    If sh.Visible <> xlSheetVisible Then CountPrintPages = 0: Exit Function
    Dim saved As Object: Set saved = ActiveSheet
    Application.ScreenUpdating = False
    sh.Activate
    Dim pages As Long
    On Error Resume Next
    pages = ExecuteExcel4Macro("GET.DOCUMENT(50)")
    On Error GoTo 0
    If pages < 1 Then pages = 1
    If Not saved Is Nothing Then saved.Activate
    Application.ScreenUpdating = True
    CountPrintPages = pages
End Function

Private Function BlockAnchors(ByVal sh As Worksheet, ByVal label As String) As Collection
    Dim c As Collection: Set c = New Collection
    Dim r As Long, last As Long
    last = sh.Cells(sh.Rows.Count, "B").End(xlUp).Row
    If last < 2000 Then last = 2000
    For r = FIRST_ROW To last
        If sh.Cells(r, "B").Value = label Then c.Add r
    Next r
    Set BlockAnchors = c
End Function

' Hide rows of a table (firstRow..lastRow) whose key columns are all empty; the first row stays visible.
Private Sub HideEmptyRows(ByVal sh As Worksheet, ByVal firstRow As Long, ByVal lastRow As Long, ByVal keyCols As Variant)
    Dim r As Long, k As Variant, used As Boolean
    For r = firstRow + 1 To lastRow
        used = False
        For Each k In keyCols
            If Len(Trim$(CStr(sh.Cells(r, CStr(k)).Value))) > 0 Then used = True: Exit For
        Next k
        If Not used Then sh.Rows(r).Hidden = True
    Next r
End Sub

' Pumps: hide the blocks after the last pump with a designation, and unnamed blocks before it.
Private Sub HidePumps(ByVal sh As Worksheet)
    Dim anchors As Collection, i As Long, a As Long, lastUsed As Long
    Const BLOCK As Long = 26
    sh.Rows.Hidden = False
    Set anchors = BlockAnchors(sh, "Pump")
    If anchors.Count = 0 Then Exit Sub
    For i = 1 To anchors.Count
        If Len(Trim$(CStr(sh.Cells(anchors(i), "D").Value))) > 0 Then lastUsed = i
    Next i
    If lastUsed = 0 Then lastUsed = 1
    For i = 1 To lastUsed
        a = anchors(i)
        If Len(Trim$(CStr(sh.Cells(a, "D").Value))) = 0 Then sh.Rows(a & ":" & a + BLOCK - 1).Hidden = True
    Next i
    If lastUsed < anchors.Count Then sh.Rows(anchors(lastUsed + 1) & ":" & anchors(anchors.Count) + BLOCK - 1).Hidden = True
    sh.PageSetup.PrintArea = "$A$1:$N$" & (anchors(lastUsed) + BLOCK - 1)
End Sub

' Valves: one system per page; pages without a system are hidden, empty valve rows too.
Private Sub HideValves(ByVal sh As Worksheet)
    Dim anchors As Collection, i As Long, a As Long, lastUsed As Long
    sh.Rows.Hidden = False
    Set anchors = BlockAnchors(sh, "System")
    If anchors.Count = 0 Then Exit Sub
    For i = 1 To anchors.Count
        If Len(Trim$(CStr(sh.Cells(anchors(i), "D").Value))) > 0 Then lastUsed = i
    Next i
    If lastUsed = 0 Then lastUsed = 1
    For i = 1 To lastUsed
        a = anchors(i)
        If Len(Trim$(CStr(sh.Cells(a, "D").Value))) = 0 And i > 1 Then
            sh.Rows(a & ":" & a + PAGE_ROWS - 1).Hidden = True
        Else
            HideEmptyRows sh, a + 6, a + 43, Array("B", "C", "H", "I", "L")
        End If
    Next i
    If lastUsed < anchors.Count Then sh.Rows(anchors(lastUsed + 1) & ":" & anchors(anchors.Count) + PAGE_ROWS - 1).Hidden = True
    sh.PageSetup.PrintArea = "$A$1:$N$" & (anchors(lastUsed) + PAGE_ROWS - 1)
End Sub

Public Sub HideUnusedBlocks()
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim sh As Worksheet, r As Long, p As Long
    Application.ScreenUpdating = False
    Set sh = FindSheet(wb, "Pumps"): If Not sh Is Nothing Then HidePumps sh
    Set sh = FindSheet(wb, "Valves"): If Not sh Is Nothing Then HideValves sh
    Set sh = FindSheet(wb, "Plant Equipment")
    If Not sh Is Nothing Then
        sh.Rows.Hidden = False
        HideEmptyRows sh, 8, 47, Array("B", "C", "I", "K")
        ' second page only when it holds data
        If Application.WorksheetFunction.CountA(sh.Range("B60:L99")) = 0 Then
            sh.Rows("56:107").Hidden = True
            sh.PageSetup.PrintArea = "$A$1:$N$55"
        Else
            HideEmptyRows sh, 60, 99, Array("B", "C", "I", "K")
        End If
    End If
    Set sh = FindSheet(wb, "Flow Measurements")
    If Not sh Is Nothing Then
        sh.Rows.Hidden = False
        HideEmptyRows sh, 8, 31, Array("B", "C", "K", "L")
    End If
    Set sh = FindSheet(wb, "System Summary")
    If Not sh Is Nothing Then
        sh.Rows.Hidden = False
        For r = 8 To 36
            If Len(Trim$(CStr(sh.Cells(r, "B").Value))) = 0 Then sh.Rows(r).Hidden = True
        Next r
    End If
    Application.ScreenUpdating = True
End Sub

Public Sub ShowAllBlocks()
    Dim sh As Worksheet
    For Each sh In ThisWorkbook.Worksheets
        If sh.Visible = xlSheetVisible Then sh.Rows.Hidden = False
    Next sh
End Sub

' ---------------------------------------------------------------------------
Public Sub SyncToCPageCounts()
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim toc As Worksheet: Set toc = FindSheet(wb, "ToC")
    If toc Is Nothing Then MsgBox "Sheet 'ToC' not found.", vbExclamation: Exit Sub
    Dim savedCalc As Long: savedCalc = Application.Calculation
    Application.Calculation = xlCalculationManual
    Application.ScreenUpdating = False
    Dim cumulative As Long, sections As Variant, entry As Variant, sheetNames As Variant
    Dim i As Long, j As Long, sh As Worksheet, missing As String, startPage As Long
    Set sh = FindSheet(wb, "Cover Page")
    If Not sh Is Nothing Then cumulative = CountPrintPages(sh)
    sections = ReportSections()
    For i = LBound(sections) To UBound(sections)
        entry = sections(i): sheetNames = entry(1): startPage = cumulative + 1
        If IsArray(sheetNames) Then
            For j = LBound(sheetNames) To UBound(sheetNames)
                Set sh = FindSheet(wb, CStr(sheetNames(j)))
                If sh Is Nothing Then
                    missing = missing & "  - row " & entry(0) & ": " & sheetNames(j) & vbCrLf
                Else
                    cumulative = cumulative + CountPrintPages(sh)
                End If
            Next j
        End If
        toc.Range("K" & CLng(entry(0))).Value = "page " & startPage
    Next i
    Application.ScreenUpdating = True
    Application.Calculation = savedCalc
    Application.Calculate
    If Len(missing) > 0 Then MsgBox "ToC updated; sheets not found:" & vbCrLf & missing, vbInformation
End Sub

' ---------------------------------------------------------------------------
Public Sub PrintReport()
    Dim answer As VbMsgBoxResult
    answer = MsgBox("Hide unused pumps, pages and rows, update the ToC, then export the report as one PDF?" & vbCrLf & _
                    "(No = send to printer, Cancel = abort)", vbYesNoCancel + vbQuestion, "Print Hydronic TAB Report")
    If answer = vbCancel Then Exit Sub
    HideUnusedBlocks
    SyncToCPageCounts
    Dim wb As Workbook: Set wb = ThisWorkbook
    Dim names As Collection: Set names = New Collection
    Dim sh As Worksheet
    For Each sh In wb.Worksheets
        If sh.Visible = xlSheetVisible And Left$(sh.Name, 1) <> "{" Then names.Add sh.Name
    Next sh
    Dim arr() As String, i As Long
    ReDim arr(1 To names.Count)
    For i = 1 To names.Count: arr(i) = names(i): Next i
    wb.Worksheets(arr).Select
    If answer = vbYes Then
        Dim path As String
        path = Application.GetSaveAsFilename(InitialFileName:=wb.Path & "\Hydronic TAB Report.pdf", FileFilter:="PDF (*.pdf), *.pdf")
        If path <> "False" Then
            ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, Filename:=path, Quality:=xlQualityStandard, _
                IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
        End If
    Else
        ActiveSheet.PrintOut
    End If
    wb.Worksheets(1).Select
End Sub
